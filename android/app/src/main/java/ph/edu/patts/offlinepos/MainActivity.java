package ph.edu.patts.offlinepos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NfcReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
