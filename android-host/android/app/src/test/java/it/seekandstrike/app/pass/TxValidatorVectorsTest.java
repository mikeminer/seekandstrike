package it.seekandstrike.app.pass;

import static org.junit.Assert.assertEquals;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

/** The Java validator must reach the same verdict as the TypeScript one on every shared vector. */
public class TxValidatorVectorsTest {
    @Test
    public void agreesWithTypeScriptOnAllVectors() throws Exception {
        try (InputStream is = getClass().getResourceAsStream("/validator-vectors.txt");
             BufferedReader in = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            assertEquals(0, VectorRunner.run(in));
        }
    }
}
