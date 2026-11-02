package it.seekandstrike.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The only app-specific native plugin: the Daily Pass transaction validator.
        registerPlugin(PassValidatorPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * The Mobile Wallet Adapter library decides that a wallet app took over by waiting for a DOM `blur`
     * after it opens the solana-wallet link. In a WebView that event does not fire when another activity (the
     * wallet's bottom sheet) covers us, so the library reports "no wallet". Relay the real focus loss to the page.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus || getBridge() == null) return;
        final WebView web = getBridge().getWebView();
        if (web != null) web.post(() -> web.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null));
    }
}
