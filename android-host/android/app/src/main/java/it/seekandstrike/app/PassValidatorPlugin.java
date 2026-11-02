package it.seekandstrike.app;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import it.seekandstrike.app.pass.TxValidator;

/**
 * The only native bridge method of the app: validates the unsigned Daily Pass transaction before it
 * is handed to the wallet. All numbers arrive as decimal strings (JS numbers lose precision above 2^53).
 * The validator trusts nothing but the reviewed values passed here; see TxValidator.
 */
@CapacitorPlugin(name = "PassValidator")
public class PassValidatorPlugin extends Plugin {
    @PluginMethod
    public void validate(PluginCall call) {
        JSObject out = new JSObject();
        try {
            TxValidator.Intent it = new TxValidator.Intent();
            it.wallet = require(call, "wallet");
            it.blockhash = require(call, "blockhash");
            it.amountIn = Long.parseLong(require(call, "amountIn"));
            it.minOut = Long.parseLong(require(call, "minOut"));
            it.target = Long.parseLong(require(call, "target"));
            it.lockId = Long.parseLong(require(call, "lockId"));
            it.unlockAt = Long.parseLong(require(call, "unlockAt"));
            it.cuPrice = Long.parseLong(require(call, "cuPrice"));
            it.includeBuybackCreate = Boolean.TRUE.equals(call.getBoolean("includeBuybackCreate"));
            it.wsolExists = Boolean.TRUE.equals(call.getBoolean("wsolExists"));
            long nowS = Long.parseLong(require(call, "nowS"));
            TxValidator.Kind kind = TxValidator.Kind.valueOf(require(call, "kind").toUpperCase());
            byte[] raw = Base64.decode(require(call, "tx"), Base64.DEFAULT);
            TxValidator.Result r = TxValidator.validate(raw, kind, it, nowS);
            out.put("ok", r.ok);
            out.put("reason", r.reason);
        } catch (RuntimeException e) {
            out.put("ok", false);
            out.put("reason", "native: bad request");
        }
        call.resolve(out);
    }

    private static String require(PluginCall call, String key) {
        String v = call.getString(key);
        if (v == null) throw new IllegalArgumentException("missing " + key);
        return v;
    }
}
