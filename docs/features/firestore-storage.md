# Firestore Cloud Storage for Pending Changes

Cloud-based pending changes storage using Google Cloud Firestore, enabling continuity across multiple devices and seamless synchronization.

---

## Overview

`@ingitdb/firestore` is a planned library that extends inGitDB's pending changes management with cloud synchronization via Google Cloud Firestore and Firebase Authentication. This enables users to:

- Access and edit pending changes from any authenticated device
- Sync changes in real-time across mobile, tablet, and desktop
- Never lose draft edits with automatic cloud backup
- Work offline with automatic sync when connectivity returns

---

## Architecture

**Implementation Details:**
- **Library:** `@ingitdb/firestore` (under development)
- **Backend:** Google Cloud Firestore
- **Collection Structure:** `users/{userId}/pending-changes/{changeId}`
- **Real-time Sync:** Firestore listeners for live updates across devices
- **Authentication:** Firebase Authentication (Google, GitHub, email)

**Key Characteristics:**
- **Multi-Device Continuity:** Access and edit pending changes on any authenticated device
- **Cloud Persistence:** Offsite backup of draft changes; resilient to device loss
- **Real-Time Synchronization:** Live updates when changes are made on other devices
- **Network Efficiency:** Only syncs changed fields using Firestore's delta updates
- **Offline Support:** Local caching with automatic sync when connectivity restored
- **Authentication:** Integrated with Firebase Authentication
- **Scalability:** Serverless architecture handles any number of users/devices
- **Cost:** Pay-per-read/write model; minimal cost for inactive users

---

## Planned Features

1. **Real-time Presence Indicators** — See who else is editing and prevent conflicts
2. **Automatic Conflict Resolution** — Last-write-wins or custom merge logic
3. **Change History & Audit Logs** — Full audit trail in Firestore
4. **Cross-Device Notifications** — Push notifications when changes are committed
5. **Selective Sync** — Choose which device syncs which changes
6. **Encryption** — Firebase Security Rules + optional client-side encryption
7. **Team Collaboration** — Share pending changes with team members (with permissions)
8. **Analytics** — Track change patterns, commit frequency, and size metrics
9. **Mobile Push Notifications** — Notify when changes sync or conflicts detected

---

## API Reference

### Initialization

```typescript
import { createFirestorePendingChangesStore } from '@ingitdb/firestore'
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

const firebaseApp = initializeApp({
  apiKey: 'YOUR_API_KEY',
  projectId: 'YOUR_PROJECT_ID',
  // ... other Firebase config
})

const firestore = getFirestore(firebaseApp)
const auth = getAuth(firebaseApp)

const store = createFirestorePendingChangesStore(firestore, auth)
```

### Core Methods

```typescript
// Load pending changes synced across devices
const changes = await store.loadForCollection(userId, repo, branch, collectionId)

// Load all pending changes for a repo/branch
const allChanges = await store.loadForRepoBranch(userId, repo, branch)

// Stage a change (automatically synced to cloud)
await store.stageDelete({
  userId,
  repo,
  branch,
  collectionId,
  recordId
})

// Unstage a change (removes from pending)
await store.unstage({
  userId,
  repo,
  branch,
  collectionId,
  recordId
})

// Listen for real-time changes from other devices
const unsubscribe = store.onChangesUpdated((changes) => {
  console.log('Changes updated from another device:', changes)
  updateUI(changes)
})

// Commit changes (clears pending state across all devices)
await store.commitAll({
  userId,
  repo,
  branch,
  message: 'User edits'
})
```

### Configuration

```typescript
const store = createFirestorePendingChangesStore(firestore, auth, {
  syncInterval: 5000,                    // Sync every 5 seconds (optional)
  encryptChanges: true,                  // Client-side encryption (optional)
  conflictResolution: 'last-write-wins', // or 'manual' for UI resolution
  enablePresence: true,                  // Show who else is editing
  batchSize: 50,                         // Batch up to 50 changes per sync
})
```

---

## User Experience & Smart Onboarding

### Enablement Panel

When a user begins making changes locally (using in-memory or IndexedDB storage), they're presented with a **subtle, non-intrusive panel** that introduces the cross-device editing capability:

| Element | Description |
|---------|---|
| **Icon** | 🔄 (sync symbol) |
| **Title** | "Edit from Any Device" |
| **Message** | "Your draft changes are currently saved locally. Enable cross-device editing to access and continue your work from any device—phone, tablet, or computer." |
| **Primary Button** | "Enable Cross-Device Editing" (triggers Firebase sign-in) |
| **Secondary Links** | "Learn More" (documentation), "Dismiss" (hide for now) |

### Onboarding Flow

1. **Smart Detection:** Panel appears once user has 1+ pending changes (not on first load)
2. **One-Click Activation:** "Enable Cross-Device Editing" button triggers Firebase sign-in
3. **Seamless Sign-In:** User authenticates with Google, GitHub, or email
4. **Instant Sync:** After sign-in, pending changes automatically upload to Firestore
5. **Real-Time Feedback:** Panel updates with status: "Synced 3 changes" or "Syncing..."
6. **Multi-Device Magic:** Changes instantly appear on other logged-in devices

### Benefits Highlighted to Users

| Icon | Benefit | Description |
|------|---------|---|
| ✨ | Never lose work | Draft changes backed up to cloud |
| 📱 | One edit everywhere | Start on mobile, finish on desktop |
| 🔒 | Secure & private | Only you can see your pending changes |
| ⚡ | No server commit needed | Work at your own pace before publishing |
| 🚀 | Instant sync | Changes available across devices in real-time |

### Panel Behavior

**Dismissible & Persistent:**
- Users can dismiss the panel (remembered for that session)
- Panel reappears on next login if Firestore sync is still not enabled
- "Learn More" link provides detailed documentation
- Users can toggle Firestore sync in account/settings at any time

**Post-Enablement Experience:**

Once enabled, users see a minimal **status indicator** in the UI:

| Status | Icon | Meaning | Action |
|--------|------|---------|--------|
| Synced | 🟢 | Changes synced with Firestore | Hover to see details |
| Syncing | 🟡 | Sync in progress | Wait for completion |
| Failed | 🔴 | Sync failed | Click to retry |

Clicking the indicator shows: `"3 pending changes synced • Last updated 2 mins ago"`

---

## Use Cases

### 1. Mobile + Desktop Workflows
Start editing a report on your phone during a commute, then continue seamlessly on your laptop at the office. All changes are synchronized in real-time.

### 2. Team Collaboration
Work on a feature branch with colleagues. Each team member can see pending changes across their devices without committing to the main repository yet.

### 3. Disaster Recovery
Never lose draft edits. If your device is lost or stolen, your pending changes are safely backed up in Firestore and accessible from any other device.

### 4. Offline-First + Cloud Hybrid
Combine local IndexedDB persistence (for offline capability) with Firestore sync (for cloud backup and multi-device support). Get the best of both worlds.

### 5. Multi-Tab Consistency
Keep pending changes in sync across browser tabs and windows. Edit in one tab, see updates instantly in another tab on the same device.

---

## Security Considerations

### Access Control
- **Firestore Security Rules** restrict access to the authenticated user's own pending changes
- Only the user who created the changes can view, edit, or delete them
- Team collaboration features (when implemented) will support fine-grained permissions

### Data Protection
- Optional **client-side encryption layer** for sensitive data (end-to-end encrypted before upload)
- **Automatic cleanup:** Changes are deleted from cloud storage after successful Git commit
- **Audit trail** available for compliance requirements (who changed what, when)

### Best Practices
1. Periodically commit pending changes to Git to reduce cloud storage usage
2. Enable client-side encryption for sensitive repositories
3. Review and revoke Firebase authentication tokens on untrusted devices
4. Use Firestore Security Rules to restrict write access to verified users

---

## Integration with Other Storage Options

### IndexedDB + Firestore (Recommended)
```typescript
// Hybrid approach: local cache + cloud sync
const idbStore = createPendingChangesStore(githubApi, cache)
const firestoreStore = createFirestorePendingChangesStore(firestore, auth)

// Changes are persisted to both IndexedDB (fast local access)
// and Firestore (cloud backup + multi-device)
await idbStore.stageDelete(changeParams)
await firestoreStore.stageDelete(changeParams)
```

### PouchDB + Firestore (Future)
When PouchDB integration is complete, users will be able to choose between:
- **PouchDB** for CouchDB-compatible sync with inGitDB's planned CouchDB adapter
- **Firestore** for Firebase-based cloud sync and multi-device support
- **Both** for maximum flexibility and portability

---

## Pricing & Deployment

### Firebase Pricing
Firestore uses a **pay-per-read/write model:**
- Read: $0.06 per 100K reads
- Write: $0.18 per 100K writes
- Delete: $0.02 per 100K deletes
- **Free tier:** 50K read/write/delete operations per day

**Cost Estimate for Active User:**
- 100 pending changes/day = ~300 writes/day (create + update + delete)
- $0.18 × (300 / 100K) = ~$0.0005/day = **~$0.15/month per active user**

### Deployment
Firestore is a fully managed, serverless service. No setup or maintenance required:
1. Create a Firebase project (free tier available)
2. Enable Firestore database
3. Configure Security Rules
4. Use `@ingitdb/firestore` in your application

---

## Troubleshooting

### Changes not syncing
- Check Firebase Authentication status: `if (!auth.currentUser) { /* user not logged in */ }`
- Verify Firestore database is initialized
- Check browser console for network errors
- Firestore quota may be exceeded; wait or upgrade plan

### Sync conflicts
- Enable `conflictResolution: 'manual'` to resolve conflicts in the UI
- Use real-time presence indicators to coordinate edits
- Firestore transactions ensure consistency

### Performance issues
- Reduce `syncInterval` if syncing too frequently (drain battery on mobile)
- Use `batchSize` to limit changes per sync request
- Consider archiving old changes to a separate collection

---

## Related Documentation

- [`pending-changes.md`](./pending-changes.md) — Overview of all pending changes storage options
- [`pouchdb-integration.md`](./pouchdb-integration.md) — CouchDB/PouchDB alternative
- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/start)
