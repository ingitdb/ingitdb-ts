import {Injectable} from '@angular/core';
import {DbRef, RepoClient} from './repo-client.interface';
import {RepoClientFactoryService} from './repo-client-factory.service';
import {IngitDbSchema} from '@ingitdb/schema';
import {SchemaService} from './schema.service';
import {Observable, throwError} from 'rxjs';
import {mergeMap, shareReplay, take} from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class IngitDbClientFactory {

  constructor(
    private readonly schemaService: SchemaService,
    private readonly repoClientFactory: RepoClientFactoryService,
  ) {
  }

  getIngitDbClient(db: DbRef): IngitDbClient {
    const repoClient = this.repoClientFactory.getRepoClient(db.host);
    const getSchema = () => this.schemaService.getSchema(db).pipe(
      take(1),
      shareReplay(1),
    );
    return new IngitDbClient(db, repoClient, getSchema);
  }
}

export class IngitDbClient {

  private readonly schema$: Observable<IngitDbSchema>;

  constructor(
    private readonly db: DbRef,
    private readonly repoClient: RepoClient,
    private readonly getSchema: () => Observable<IngitDbSchema>,
  ) {
    this.schema$ = getSchema();
  }

  getRecord(collection: string, id: string): unknown {
    throw new Error('not implemented yet')
  }

  list(collectionId: string, view: string): Observable<any[]> {
    return this.schema$.pipe(
      mergeMap(schema => {
        const collection = schema.collections.find(c => c.id == collectionId)
        if (!collection) {
          return throwError(() => 'unknown collection: ' + collectionId);
        }
        return this.repoClient.getRaw<any[]>(this.db, `${collection.path}/${view}.json`)
      })
    );
  }
}
