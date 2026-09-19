# The Prayer Project Badge System

Mobile-first credentialing application for **badge.ask4prayers.com**.

## What is included

- Issue official Prayer Project badges without person photos
- Badge-holder login using exact name and a 4-digit PIN
- First login creates the holder's PIN
- Private **My Badge** page
- Downloadable phone badge image
- Installable PWA / Add to Home Screen experience
- Full-page printable credential
- QR camera scanner
- Live verification for active, suspended, revoked, lost, stolen, and expired badges
- Mandatory public revocation reason
- Scan logging for valid, revoked, expired, and invalid scans
- Administrator dashboard, badge directory, revocation, suspension, restoration, and replacement
- One-time initial administrator bootstrap
- No composite Firestore indexes required

## Firebase setup

The web app is already configured for Firebase project `badge-tpp`.

Before using it:

1. Open **Firebase Authentication → Sign-in method** and enable **Email/Password**.
2. Open **Firebase Authentication → Settings → Authorized domains** and add `badge.ask4prayers.com`.
3. Create/enable the project's **Cloud Firestore** database.
4. Deploy the included `firestore.rules`.

With the Firebase CLI:

```bash
firebase login
firebase use badge-tpp
firebase deploy --only firestore:rules
```

## First administrator

After Firebase Authentication and Firestore rules are ready, open:

`https://badge.ask4prayers.com/#/bootstrap`

Enter the administrator name, create a four-digit PIN, and use the one-time setup code supplied separately with the initial deployment.

After the bootstrap document is created, the Firestore rules do not allow the first-admin flow to initialize again.

## Holder flow

1. An administrator issues a badge.
2. The holder opens **Badge Holder Login**.
3. The holder enters the exact full name used at issuance.
4. On first access, the holder creates a four-digit PIN.
5. Future access uses the same full name and PIN.

## Security note

The QR code uses a long random credential token rather than embedding personal data. Public credential records expose only the information needed to verify a badge. Administrative badge records and the complete scan log are restricted to administrators.

A four-digit PIN is intentionally convenient and is backed by Firebase Authentication rate limiting, but a future high-security version should add a one-time enrollment secret or second factor if badges are ever used for sensitive physical access.
