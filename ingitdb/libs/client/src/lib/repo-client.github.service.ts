import {DbRef, RepoClient} from './repo-client.interface';
import {HttpClient} from '@angular/common/http';
import {Observable, throwError} from 'rxjs';
import {IngitDbSchema} from '@ingitdb/schema';

export class GithubRepoService implements RepoClient {
  constructor(
    private readonly http: HttpClient,
  ) {
  }

  getSchema(dbRef: DbRef): Observable<IngitDbSchema> {
    return throwError(() => 'not implemented yet');
  }

  getRaw<T>(db: DbRef, path: string): Observable<T> {
    const url = GithubRepoService.getRawUrl(db, path);
    return this.http.get<T>(url);
  }

  private static getRawUrl(db: DbRef, path: string): string {
    let host: string;
    switch (db.host) {
      case 'github.com':
        // noinspection SpellCheckingInspection
        host = 'raw.githubusercontent.com';
        break;
      default:
        throw new Error('unknown host: ' + db.host);
    }
    const dbPath = db.path || '/';
    return `https://${host}/${db.org}/${db.rep}${dbPath}${path}`;
  }
}
