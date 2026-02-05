import {Observable} from 'rxjs';
import {CollectionSchema, DbSchema} from '@ingitdb/schema';

export interface DbRef {
  host: string;
  org: string;
  repo: string;
  at: string; // Either: <BRANCH_NAME>, <HASH>, <TAG>
}

export function dbRefPath(db: DbRef): string {
  return `${db.host}/${db.repo}~${db.at}@${db.org}`;
}

export interface Row {
}

export interface IngitDB {
  getDbSchema(db: DbRef): Observable<DbSchema>;

  getCollectionSchema(db: DbRef): Observable<CollectionSchema>

  getViewData(collectionId: string, view: string): Observable<Row[]>;

  deleteRows(db: DbRef, collection: string, ids: string): Observable<void>;

  addRows(db: DbRef, collection: string, rows: Row[]): Observable<void>;
}

export interface RepoClient {

  branch(from: string, to: string): Observable<void>;

  getFile<T>(db: DbRef, path: string): Observable<T>;

  saveFile<T>(db: DbRef, path: string, raw: T): Observable<void>;
}

