import {DbRef, RepoClient} from './repo-client.interface';
import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {Observable, throwError} from 'rxjs';

@Injectable()
export class GithubRepoService implements RepoClient {
  constructor(
    private readonly http: HttpClient,
  ) {
  }

  branch(_from: string, _to: string): Observable<void> {
    return throwError(() => new Error('Method not implemented.'));
  }

  getFile<T>(db: DbRef, path: string): Observable<T> {
    const url = GithubRepoService.getRawUrl(db, path);
    return this.http.get<T>(url);
  }

  saveFile<T>(_db: DbRef, _path: string, _raw: T): Observable<void> {
    return throwError(() => new Error('Method not implemented.'));
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
    return `https://${host}/${db.org}/${db.repo}/${db.at}/${path}`;
  }
}
