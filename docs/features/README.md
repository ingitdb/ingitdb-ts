# inGitDB Features

This directory documents key features and integrations for inGitDB.

## Features

### [Pending Changes Management](./pending-changes.md)
- How user edits are stored locally before being committed to Git
- Storage options: in-memory, IndexedDB (implemented), and PouchDB (planned)
- Change lifecycle, data structures, and configuration
- Browser compatibility and security considerations

### [PouchDB Integration](./pouchdb-integration.md)
- Offline-first architecture using PouchDB/CouchDB
- Local data caching and synchronization strategies
- Handling nested subcollections and hierarchical data
- Conflict resolution and offline edit capabilities
- Implementation phases and security considerations

## Implementation Status

| Feature | Status | Documentation |
|---------|--------|---|
| Pending Changes (In-Memory & IndexedDB) | Implemented | [pending-changes.md](./pending-changes.md) |
| Pending Changes (PouchDB) | Planned | [pending-changes.md](./pending-changes.md) |
| PouchDB Integration | Planned | [pouchdb-integration.md](./pouchdb-integration.md) |

## Adding New Features

When documenting a new feature:

1. Create a new markdown file in this directory
2. Follow the structure: Overview → Architecture → Implementation → Examples
3. Add an entry to this README
4. Include links to related documentation and external references
