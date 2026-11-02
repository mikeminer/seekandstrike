package it.seekandstrike.app.pass;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Native pre-wallet validator for Daily Pass transactions (pure Java, no Android classes, so it runs
 * in plain JVM unit tests). Java twin of client/src/pass/validator.ts.
 *
 * Threat model: the WebView/JS layer is NOT trusted. The only inputs taken from it are the values the
 * player reviewed (wallet, blockhash, amounts, lock id, end time, priority fee and two flags). Every
 * account is derived here from fixed program ids and mints, the expected instructions are rebuilt
 * byte for byte, and the unsigned transaction handed to the wallet must match them exactly.
 *
 * The route is fixed: 0.01 SOL -> PASTA in the Meteora DAMM v2 pool below, then PASTA is locked for one day in the
 * same transaction. The pool, its vaults and the mints are constants here (Java does not trust the JavaScript);
 * if the pool changes on chain, validation fails closed until the app is updated.
 */
public final class TxValidator {
    private TxValidator() {}

    // ---- Constants (same as client/src/pass/constants.ts) ----
    static final String FRIDGE_PROGRAM = "9RY54dNPYTzDyh3TfFqDdt2b2KMM56KW1tw9erRTGQo6";
    static final String DAMM_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
    static final String DAMM_POOL = "9RTD1Es749sYfaz4gNQGd9iQi2ougzRcvmzzYvEqskXN";
    static final String DAMM_POOL_AUTHORITY = "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC";
    /** Pool vaults (token A = PASTA, token B = wSOL), read from the pool account on mainnet 2026-10-29. */
    static final String DAMM_VAULT_A = "Hmokxd8TwUYGPNWgZ2BrFd9R9P1784CpziDF7R4hn7FF";
    static final String DAMM_VAULT_B = "BpQF5AHNPiWZAtuaiH1TPFzSBDkAtQTiL4EWqhxmzGaD";
    static final String TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    static final String TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    static final String ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
    static final String SYSTEM_PROGRAM = "11111111111111111111111111111111";
    static final String COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
    static final String WSOL_MINT = "So11111111111111111111111111111111111111112";
    static final String PASTA_MINT = "39kMeX4HVRW9qbbiHSPbRQ9xeXUF18GrNP6gL61Ppump";
    /** The token the pass locks. */
    static final String PASS_MINT = PASTA_MINT;

    static final byte[] DISC_CREATE_LOCK = hex("abd85ca7a508995a");
    static final byte[] DISC_DAMM_SWAP = hex("f8c69e91e17587c8");

    static final long NOMINAL_LAMPORTS = 10_000_000L;
    static final long PASS_SECONDS = 86_400L;
    static final long COMPUTE_UNIT_LIMIT = 300_000L;
    static final long COMPUTE_UNIT_LIMIT_LOCK_ONLY = 60_000L;
    static final long MAX_COMPUTE_UNITS = 400_000L;
    static final long MAX_PRIORITY_MICROLAMPORTS = 200_000L;
    static final int TX_SIZE_LIMIT = 1232;

    public enum Kind { SINGLE, SWAP, LOCK }

    /** Values the player reviewed. */
    public static final class Intent {
        public String wallet;
        public String blockhash;
        public long amountIn;
        public long minOut;
        public long target;
        public long lockId;
        public long unlockAt;
        public long cuPrice;
        /** Ignored since 2026-10-29 (no buyback account any more); kept so the shared vector format stays the same. */
        public boolean includeBuybackCreate;
        public boolean wsolExists;
    }

    public static final class Result {
        public final boolean ok;
        public final String reason;
        Result(boolean ok, String reason) { this.ok = ok; this.reason = reason; }
        static final Result OK = new Result(true, "");
        static Result fail(String r) { return new Result(false, r); }
        @Override public String toString() { return ok ? "ok" : "fail: " + reason; }
    }

    // ---- Expected / decoded instruction model ----
    static final class Meta {
        final byte[] key; final boolean signer; final boolean writable;
        Meta(byte[] key, boolean signer, boolean writable) { this.key = key; this.signer = signer; this.writable = writable; }
    }
    static final class Ix {
        final byte[] program; final List<Meta> metas; final byte[] data;
        Ix(byte[] program, List<Meta> metas, byte[] data) { this.program = program; this.metas = metas; this.data = data; }
    }

    // ---- Public API ----
    public static Result validate(byte[] raw, Kind kind, Intent it, long nowS) {
        try {
            return validateInner(raw, kind, it, nowS);
        } catch (RuntimeException e) {
            return Result.fail("decode: " + e.getMessage());
        }
    }

    private static Result validateInner(byte[] raw, Kind kind, Intent it, long nowS) {
        if (raw.length > TX_SIZE_LIMIT) return Result.fail("decode: too large");
        byte[] wallet = Base58.decode32(it.wallet);
        byte[] blockhash = Base58.decode32(it.blockhash);
        Reader r = new Reader(raw);
        int nsig = r.cu16();
        if (nsig > 4) return Result.fail("decode: too many signatures");
        boolean zero = true;
        for (int i = 0; i < nsig; i++) for (byte b : r.bytes(64)) if (b != 0) zero = false;
        if (r.u8() != 0x80) return Result.fail("decode: not a v0 message");
        int[] header = {r.u8(), r.u8(), r.u8()};
        int nkeys = r.cu16();
        if (nkeys > 64) return Result.fail("decode: too many keys");
        List<byte[]> keys = new ArrayList<>();
        for (int i = 0; i < nkeys; i++) keys.add(r.bytes(32));
        byte[] bh = r.bytes(32);
        int nix = r.cu16();
        if (nix > 16) return Result.fail("decode: too many instructions");
        List<int[]> ixRaw = new ArrayList<>();
        List<byte[]> ixData = new ArrayList<>();
        for (int k = 0; k < nix; k++) {
            int p = r.u8();
            if (p >= nkeys) return Result.fail("decode: program index");
            int na = r.cu16();
            if (na > 48) return Result.fail("decode: too many accounts");
            int[] row = new int[na + 1];
            row[0] = p;
            for (int j = 0; j < na; j++) {
                int a = r.u8();
                if (a >= nkeys) return Result.fail("decode: account index");
                row[j + 1] = a;
            }
            int dl = r.cu16();
            if (dl > 1024) return Result.fail("decode: data too long");
            ixRaw.add(row);
            ixData.add(r.bytes(dl));
        }
        int lookups = r.cu16();
        if (r.o != raw.length) return Result.fail("decode: trailing bytes");

        if (nsig != 1 || header[0] != 1) return Result.fail("exactly one signer");
        if (!zero) return Result.fail("already signed");
        if (header[1] != 0) return Result.fail("fee payer must be writable");
        if (lookups != 0) return Result.fail("lookup tables are not allowed");
        if (!Arrays.equals(keys.get(0), wallet)) return Result.fail("signer is not the connected wallet");
        if (!Arrays.equals(bh, blockhash)) return Result.fail("unexpected blockhash");
        Set<String> uniq = new HashSet<>();
        for (byte[] k : keys) uniq.add(Base58.encode(k));
        if (uniq.size() != keys.size()) return Result.fail("duplicate keys");

        if (kind != Kind.LOCK && it.amountIn != NOMINAL_LAMPORTS) return Result.fail("the purchase must be exactly the nominal amount");
        if (it.minOut <= 0) return Result.fail("no guaranteed amount");
        if (it.cuPrice < 0 || it.cuPrice > MAX_PRIORITY_MICROLAMPORTS) return Result.fail("priority fee too high");
        if (it.lockId < 1 || it.lockId > 64) return Result.fail("bad lock id");

        List<Ix> expected = instructionsFor(kind, it, wallet);
        if (nix != expected.size()) return Result.fail("unexpected instruction count");

        // Message-level flags expected: union over instructions plus the fee payer.
        Map<String, boolean[]> want = new HashMap<>();
        want.put(Base58.encode(wallet), new boolean[] {true, true});
        for (Ix ix : expected) {
            String pid = Base58.encode(ix.program);
            want.putIfAbsent(pid, new boolean[] {false, false});
            for (Meta m : ix.metas) {
                boolean[] cur = want.computeIfAbsent(Base58.encode(m.key), x -> new boolean[] {false, false});
                cur[0] |= m.signer;
                cur[1] |= m.writable;
            }
        }
        if (want.size() != keys.size()) return Result.fail("unexpected accounts in message");
        for (int i = 0; i < keys.size(); i++) {
            boolean[] w = want.get(Base58.encode(keys.get(i)));
            if (w == null) return Result.fail("unknown account in message");
            boolean signer = i < header[0];
            boolean writable = i < header[0] ? i < header[0] - header[1] : i < keys.size() - header[2];
            if (w[0] != signer || w[1] != writable) return Result.fail("account permission mismatch");
        }

        int cuLimits = 0;
        for (int i = 0; i < expected.size(); i++) {
            Ix e = expected.get(i);
            int[] row = ixRaw.get(i);
            byte[] data = ixData.get(i);
            if (!Arrays.equals(keys.get(row[0]), e.program)) return Result.fail("instruction " + i + ": program mismatch");
            if (row.length - 1 != e.metas.size()) return Result.fail("instruction " + i + ": account count");
            for (int j = 0; j < e.metas.size(); j++) {
                if (!Arrays.equals(keys.get(row[j + 1]), e.metas.get(j).key)) return Result.fail("instruction " + i + ": account " + j + " mismatch");
            }
            String pid = Base58.encode(e.program);
            if (pid.equals(COMPUTE_BUDGET_PROGRAM)) {
                if (data.length > 0 && data[0] == 2) {
                    cuLimits++;
                    if (data.length != 5) return Result.fail("bad compute limit");
                    if (le32(data, 1) > MAX_COMPUTE_UNITS) return Result.fail("compute limit too high");
                } else if (data.length > 0 && data[0] == 3) {
                    if (data.length != 9) return Result.fail("bad priority fee");
                    if (Long.compareUnsigned(le64(data, 1), MAX_PRIORITY_MICROLAMPORTS) > 0) return Result.fail("priority fee too high");
                } else return Result.fail("unexpected compute budget instruction");
                if (!Arrays.equals(data, e.data)) return Result.fail("instruction " + i + ": data mismatch");
                continue;
            }
            if (startsWith(e.data, DISC_CREATE_LOCK)) {
                if (data.length != 32 || !startsWith(data, DISC_CREATE_LOCK)) return Result.fail("pass instruction layout");
                if (le64(data, 8) != it.minOut) return Result.fail("pass amount differs from the guaranteed amount");
                long unlock = le64(data, 16);
                if (unlock < nowS + PASS_SECONDS - 1800 || unlock > nowS + PASS_SECONDS + 300) return Result.fail("pass end time outside the allowed window");
                if (le64(data, 24) != it.lockId) return Result.fail("lock id mismatch");
                if (unlock != it.unlockAt) return Result.fail("pass end time differs from the reviewed one");
                continue;
            }
            if (startsWith(e.data, DISC_DAMM_SWAP)) {
                if (data.length != 24) return Result.fail("swap layout");
                if (le64(data, 8) != it.amountIn) return Result.fail("swap input differs from the review");
                if (le64(data, 16) != it.minOut) return Result.fail("swap minimum differs from the review");
            }
            if (!Arrays.equals(data, e.data)) return Result.fail("instruction " + i + ": data mismatch");
        }
        if (cuLimits != 1) return Result.fail("exactly one compute limit");
        return Result.OK;
    }

    // ---- Expected instructions (mirror of client/src/pass/txbuilder.ts) ----
    static List<Ix> instructionsFor(Kind kind, Intent it, byte[] user) {
        List<Ix> out = new ArrayList<>();
        out.add(setCuLimit(kind == Kind.LOCK ? COMPUTE_UNIT_LIMIT_LOCK_ONLY : COMPUTE_UNIT_LIMIT));
        if (it.cuPrice > 0) out.add(setCuPrice(it.cuPrice));
        if (kind != Kind.LOCK) out.addAll(swapInstructions(user, it));
        if (kind != Kind.SWAP) out.add(createLock(user, it.minOut, it.unlockAt, it.lockId));
        return out;
    }

    static List<Ix> swapInstructions(byte[] user, Intent it) {
        byte[] wsol = Base58.decode32(WSOL_MINT);
        byte[] pass = Base58.decode32(PASS_MINT);
        byte[] tokenProg = Base58.decode32(TOKEN_PROGRAM);
        byte[] token22 = Base58.decode32(TOKEN_2022_PROGRAM);
        byte[] wsolAta = ata(user, wsol, tokenProg);
        List<Ix> out = new ArrayList<>();
        if (!it.wsolExists) out.add(createAtaIdempotent(user, user, wsol, tokenProg));
        out.add(transferLamports(user, wsolAta, it.amountIn));
        out.add(new Ix(tokenProg, List.of(new Meta(wsolAta, false, true)), new byte[] {17}));
        out.add(createAtaIdempotent(user, user, pass, token22));
        out.add(dammSwap(user, it.amountIn, it.minOut));
        if (!it.wsolExists) out.add(new Ix(tokenProg, List.of(new Meta(wsolAta, false, true), new Meta(user, false, true), new Meta(user, true, false)), new byte[] {9}));
        return out;
    }

    static Ix setCuLimit(long units) {
        byte[] d = new byte[5];
        d[0] = 2;
        putLe32(d, 1, units);
        return new Ix(Base58.decode32(COMPUTE_BUDGET_PROGRAM), List.of(), d);
    }

    static Ix setCuPrice(long micro) {
        byte[] d = new byte[9];
        d[0] = 3;
        putLe64(d, 1, micro);
        return new Ix(Base58.decode32(COMPUTE_BUDGET_PROGRAM), List.of(), d);
    }

    static Ix createAtaIdempotent(byte[] payer, byte[] owner, byte[] mint, byte[] tokenProgram) {
        return new Ix(Base58.decode32(ATA_PROGRAM), List.of(
            new Meta(payer, true, true), new Meta(ata(owner, mint, tokenProgram), false, true), new Meta(owner, false, false),
            new Meta(mint, false, false), new Meta(Base58.decode32(SYSTEM_PROGRAM), false, false), new Meta(tokenProgram, false, false)), new byte[] {1});
    }

    static Ix transferLamports(byte[] from, byte[] to, long lamports) {
        byte[] d = new byte[12];
        putLe32(d, 0, 2);
        putLe64(d, 4, lamports);
        return new Ix(Base58.decode32(SYSTEM_PROGRAM), List.of(new Meta(from, true, true), new Meta(to, false, true)), d);
    }

    static Ix createLock(byte[] user, long amount, long unlockAt, long lockId) {
        byte[] fridge = Base58.decode32(FRIDGE_PROGRAM);
        byte[] mint = Base58.decode32(PASS_MINT);
        byte[] token22 = Base58.decode32(TOKEN_2022_PROGRAM);
        byte[] lock = Pda.find(new byte[][] {"lock".getBytes(StandardCharsets.UTF_8), user, mint, u64(lockId)}, fridge);
        byte[] vault = ata(lock, mint, token22);
        byte[] d = new byte[32];
        System.arraycopy(DISC_CREATE_LOCK, 0, d, 0, 8);
        putLe64(d, 8, amount);
        putLe64(d, 16, unlockAt);
        putLe64(d, 24, lockId);
        return new Ix(fridge, List.of(
            new Meta(user, true, true), new Meta(mint, false, false), new Meta(ata(user, mint, token22), false, true),
            new Meta(lock, false, true), new Meta(vault, false, true), new Meta(token22, false, false),
            new Meta(Base58.decode32(ATA_PROGRAM), false, false), new Meta(Base58.decode32(SYSTEM_PROGRAM), false, false)), d);
    }

    /** cp-amm `swap`: spend wSOL (token B), receive PASTA (token A). Account order from the pinned IDL (cp_amm 0.2.5). */
    static Ix dammSwap(byte[] user, long amountIn, long minOut) {
        byte[] damm = Base58.decode32(DAMM_PROGRAM);
        byte[] wsol = Base58.decode32(WSOL_MINT);
        byte[] pass = Base58.decode32(PASS_MINT);
        byte[] tokenProg = Base58.decode32(TOKEN_PROGRAM);
        byte[] token22 = Base58.decode32(TOKEN_2022_PROGRAM);
        byte[] eventAuth = Pda.find(new byte[][] {"__event_authority".getBytes(StandardCharsets.UTF_8)}, damm);
        List<Meta> m = new ArrayList<>(List.of(
            new Meta(Base58.decode32(DAMM_POOL_AUTHORITY), false, false),
            new Meta(Base58.decode32(DAMM_POOL), false, true),
            new Meta(ata(user, wsol, tokenProg), false, true),
            new Meta(ata(user, pass, token22), false, true),
            new Meta(Base58.decode32(DAMM_VAULT_A), false, true),
            new Meta(Base58.decode32(DAMM_VAULT_B), false, true),
            new Meta(pass, false, false),
            new Meta(wsol, false, false),
            new Meta(user, true, false),
            new Meta(token22, false, false),
            new Meta(tokenProg, false, false),
            new Meta(damm, false, false), // optional referral account: the program id means "none"
            new Meta(eventAuth, false, false),
            new Meta(damm, false, false)));
        byte[] d = new byte[24];
        System.arraycopy(DISC_DAMM_SWAP, 0, d, 0, 8);
        putLe64(d, 8, amountIn);
        putLe64(d, 16, minOut);
        return new Ix(damm, m, d);
    }

    static byte[] ata(byte[] owner, byte[] mint, byte[] tokenProgram) {
        return Pda.find(new byte[][] {owner, tokenProgram, mint}, Base58.decode32(ATA_PROGRAM));
    }

    // ---- Byte helpers ----
    static final class Reader {
        int o = 0;
        final byte[] b;
        Reader(byte[] b) { this.b = b; }
        int u8() { if (o >= b.length) throw new IllegalArgumentException("eof"); return b[o++] & 0xff; }
        byte[] bytes(int n) {
            if (n < 0 || o + n > b.length) throw new IllegalArgumentException("eof");
            byte[] s = Arrays.copyOfRange(b, o, o + n);
            o += n;
            return s;
        }
        int cu16() {
            int v = 0;
            for (int i = 0; i < 3; i++) {
                int x = u8();
                v |= (x & 0x7f) << (7 * i);
                if ((x & 0x80) == 0) {
                    if (i > 0 && x == 0) throw new IllegalArgumentException("non-canonical compact-u16");
                    return v;
                }
            }
            throw new IllegalArgumentException("compact-u16 overflow");
        }
    }

    static boolean startsWith(byte[] a, byte[] prefix) {
        if (a.length < prefix.length) return false;
        for (int i = 0; i < prefix.length; i++) if (a[i] != prefix[i]) return false;
        return true;
    }
    static long le32(byte[] d, int off) { long v = 0; for (int i = 3; i >= 0; i--) v = (v << 8) | (d[off + i] & 0xffL); return v; }
    static long le64(byte[] d, int off) { long v = 0; for (int i = 7; i >= 0; i--) v = (v << 8) | (d[off + i] & 0xffL); return v; }
    static void putLe32(byte[] d, int off, long v) { for (int i = 0; i < 4; i++) d[off + i] = (byte) (v >>> (8 * i)); }
    static void putLe64(byte[] d, int off, long v) { for (int i = 0; i < 8; i++) d[off + i] = (byte) (v >>> (8 * i)); }
    static byte[] u64(long v) { byte[] d = new byte[8]; putLe64(d, 0, v); return d; }
    static byte[] hex(String s) {
        byte[] o = new byte[s.length() / 2];
        for (int i = 0; i < o.length; i++) o[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        return o;
    }

    // ---- Base58 ----
    static final class Base58 {
        private static final String ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        static byte[] decode32(String s) {
            if (s == null || s.isEmpty() || s.length() > 44) throw new IllegalArgumentException("bad base58");
            BigInteger n = BigInteger.ZERO;
            for (char c : s.toCharArray()) {
                int i = ALPHABET.indexOf(c);
                if (i < 0) throw new IllegalArgumentException("bad base58");
                n = n.multiply(BigInteger.valueOf(58)).add(BigInteger.valueOf(i));
            }
            byte[] raw = n.toByteArray();
            int lead = 0;
            while (lead < s.length() && s.charAt(lead) == '1') lead++;
            int start = 0;
            while (start < raw.length && raw[start] == 0) start++;
            int len = raw.length - start;
            if (lead + len != 32) throw new IllegalArgumentException("bad base58 length");
            byte[] out = new byte[32];
            System.arraycopy(raw, start, out, 32 - len, len);
            return out;
        }
        static String encode(byte[] in) {
            BigInteger n = new BigInteger(1, in);
            StringBuilder sb = new StringBuilder();
            BigInteger fifty8 = BigInteger.valueOf(58);
            while (n.signum() > 0) {
                BigInteger[] qr = n.divideAndRemainder(fifty8);
                sb.append(ALPHABET.charAt(qr[1].intValue()));
                n = qr[0];
            }
            for (byte b : in) { if (b == 0) sb.append('1'); else break; }
            return sb.reverse().toString();
        }
    }

    // ---- Program derived addresses ----
    static final class Pda {
        private static final BigInteger P = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19));
        private static final BigInteger D = BigInteger.valueOf(-121665).multiply(BigInteger.valueOf(121666).modInverse(P)).mod(P);

        static byte[] find(byte[][] seeds, byte[] program) {
            try {
                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                for (int bump = 255; bump >= 0; bump--) {
                    sha.reset();
                    for (byte[] s : seeds) sha.update(s);
                    sha.update((byte) bump);
                    sha.update(program);
                    sha.update("ProgramDerivedAddress".getBytes(StandardCharsets.UTF_8));
                    byte[] h = sha.digest();
                    if (!onCurve(h)) return h;
                }
            } catch (java.security.NoSuchAlgorithmException e) {
                throw new IllegalStateException(e);
            }
            throw new IllegalStateException("no viable bump");
        }

        /** ed25519 point decompression test: x^2 = (y^2 - 1) / (d y^2 + 1) must be a square mod p. */
        static boolean onCurve(byte[] key) {
            byte[] le = key.clone();
            le[31] &= 0x7f;
            byte[] be = new byte[32];
            for (int i = 0; i < 32; i++) be[i] = le[31 - i];
            BigInteger y = new BigInteger(1, be).mod(P);
            BigInteger y2 = y.multiply(y).mod(P);
            BigInteger u = y2.subtract(BigInteger.ONE).mod(P);
            BigInteger v = D.multiply(y2).add(BigInteger.ONE).mod(P);
            if (v.signum() == 0) return false;
            BigInteger x2 = u.multiply(v.modInverse(P)).mod(P);
            if (x2.signum() == 0) return true;
            return x2.modPow(P.subtract(BigInteger.ONE).shiftRight(1), P).equals(BigInteger.ONE);
        }
    }
}
