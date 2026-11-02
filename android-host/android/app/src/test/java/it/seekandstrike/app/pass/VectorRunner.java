package it.seekandstrike.app.pass;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Base64;

/**
 * Runs the TypeScript-generated vectors (validator-vectors.txt) through the Java validator.
 * Used by {@link TxValidatorVectorsTest} under Gradle and runnable alone with plain javac:
 *   javac -d out TxValidator.java VectorRunner.java && java -cp out it.seekandstrike.app.pass.VectorRunner validator-vectors.txt
 */
public final class VectorRunner {
    private VectorRunner() {}

    /** Returns the number of mismatching vectors (0 = all agree); prints each mismatch. */
    public static int run(BufferedReader in) throws IOException {
        int total = 0, bad = 0;
        String line;
        while ((line = in.readLine()) != null) {
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] f = line.split("\t");
            if (f.length != 15) { System.out.println("MALFORMED: " + line); bad++; continue; }
            TxValidator.Intent it = new TxValidator.Intent();
            it.wallet = f[3]; it.blockhash = f[4];
            it.amountIn = Long.parseLong(f[5]); it.minOut = Long.parseLong(f[6]); it.target = Long.parseLong(f[7]);
            it.lockId = Long.parseLong(f[8]); it.unlockAt = Long.parseLong(f[9]);
            long nowS = Long.parseLong(f[10]);
            it.cuPrice = Long.parseLong(f[11]);
            it.includeBuybackCreate = f[12].equals("1"); it.wsolExists = f[13].equals("1");
            TxValidator.Result r = TxValidator.validate(Base64.getDecoder().decode(f[14]), TxValidator.Kind.valueOf(f[1].toUpperCase()), it, nowS);
            boolean wantOk = f[2].equals("ok");
            total++;
            if (r.ok != wantOk) { bad++; System.out.println("MISMATCH " + f[0] + ": TypeScript=" + f[2] + " Java=" + r); }
        }
        System.out.println(total + " vectors, " + bad + " mismatches");
        return bad;
    }

    public static void main(String[] args) throws IOException {
        try (BufferedReader in = args.length > 0
            ? Files.newBufferedReader(Paths.get(args[0]), StandardCharsets.UTF_8)
            : new BufferedReader(new InputStreamReader(VectorRunner.class.getResourceAsStream("/validator-vectors.txt"), StandardCharsets.UTF_8))) {
            System.exit(run(in) == 0 ? 0 : 1);
        }
    }
}
