# How PATTS POS works

PATTS POS is a local prototype for a reloadable student wallet. Its teller interface is available in the browser and bundled into the Android app. The card reader is simulated until hardware integration is tested.

```mermaid
flowchart LR
  A[Teller unlocks station with local PIN] --> B[Select student or simulate card tap]
  B --> C[Enter amount]
  C --> D{Add funds or deduct payment}
  D --> E[Review and confirm]
  E --> F[Validate balance and save transaction]
  F --> G[(IndexedDB: wallets, audit history, teller settings)]
  G --> H[Updated balance and activity]
  G --> I[JSON backup and restore]
```

## Components and data

```mermaid
flowchart TB
  UI[HTML, CSS, JavaScript teller UI] --> LOGIC[Wallet and transaction rules]
  LOGIC --> DB[(IndexedDB on this device)]
  UI --> PIN[Local teller PIN check]
  PIN --> DB
  UI --> BACKUP[Export or restore JSON backup]
  BACKUP --> DB
  UI --> SIM[Simulated ID tap]
  SIM --> DB
  WEB[Browser] --> UI
  APK[Capacitor Android app] --> UI
```

The app seeds 20 demonstration wallets on first use. Each confirmed add or deduct action updates the wallet and writes an audit record with the teller name. The backup contains wallet, transaction, and local teller-setting records, so it should be handled as sensitive data even in a pilot.

There is no server synchronization, real-money settlement, or working RFID/NFC reader. See the [README](../README.md#prototype-limitations) for deployment limits.
