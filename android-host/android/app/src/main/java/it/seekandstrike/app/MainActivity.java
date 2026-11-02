package it.seekandstrike.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The only app-specific native plugin: the Daily Pass transaction validator.
        registerPlugin(PassValidatorPlugin.class);
        super.onCreate(savedInstanceState);
        immersive();
    }

    /** Full-screen game: status and navigation bars hidden; a swipe from the edge shows them briefly. */
    private void immersive() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }

    /**
     * The Mobile Wallet Adapter library decides that a wallet app took over by waiting for a DOM `blur`
     * after it opens the solana-wallet link. In a WebView that event does not fire when another activity (the
     * wallet's bottom sheet) covers us, so the library reports "no wallet". Relay the real focus loss to the page.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) { immersive(); return; }
        if (getBridge() == null) return;
        final WebView web = getBridge().getWebView();
        if (web != null) web.post(() -> web.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null));
    }
}
