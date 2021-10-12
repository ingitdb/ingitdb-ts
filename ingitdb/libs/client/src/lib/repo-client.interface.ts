import {Observable} from 'rxjs';
import {IngitDbSchema} from '@ingitdb/schema';

export interface DbRef {
  host: string;
  org: string;
  rep: string;
  branch: string;
  path?: string;
}

export interface RepoClient {

  getRaw<T>(db: DbRef, path: string): Observable<T>;

  getSchema(db: DbRef): Observable<IngitDbSchema>;
}

