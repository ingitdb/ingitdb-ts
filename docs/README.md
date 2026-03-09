# inGitDB Documentation

Welcome to the inGitDB documentation. This directory contains comprehensive guides and technical documentation for understanding and using the inGitDB project.

## Contents

### [Architecture & Design](./decoupling-from-ws.md)
- **File:** `decoupling-from-ws.md`
- Overview of the client library architecture and extraction strategy
- Details on how `@ingitdb/client` was decoupled from the Vue-based `ingitdb-ws`
- Package structure, design principles, and migration roadmap

### [Pending Changes Management](./pending-changes.md)
- **File:** `pending-changes.md`
- How user edits are stored locally before being committed to Git
- Storage options: in-memory, IndexedDB (implemented), and PouchDB (planned)
- Change lifecycle, configuration, and future enhancements

### [Features](./features/README.md)
- Comprehensive feature documentation and integration guides
- Details on PouchDB/CouchDB integration for offline-first capabilities
- Planned and implemented features

## Quick Navigation

- **New to inGitDB?** Start with the [Architecture Guide](./decoupling-from-ws.md) to understand the project structure
- **How do pending changes work?** See the [Pending Changes Management](./pending-changes.md) guide
- **Interested in offline-first?** See the [PouchDB Integration](./features/pouchdb-integration.md) documentation
- **Contributing?** Check individual feature docs for implementation details and design decisions

## Document Conventions

- **Architecture docs** explain the "why" and "how" of major design decisions
- **Feature docs** provide implementation details, examples, and integration guides
- All paths use forward slashes and are relative to the repository root
