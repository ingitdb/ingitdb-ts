import {Injectable} from '@angular/core';
import {DbRef, IngitDB, RepoClient, Row} from './repo-client.interface';
import {RepoClientFactoryService} from './repo-client-factory.service';
import {CollectionSchema, DbSchema} from '@ingitdb/schema';
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

export class IngitDbClient implements IngitDB {

  private readonly schema$: Observable<DbSchema>;

  constructor(
    private readonly db: DbRef,
    private readonly repoClient: RepoClient,
    private readonly getSchema: () => Observable<DbSchema>,
  ) {
    this.schema$ = getSchema();
  }

  getDbSchema(_db: DbRef): Observable<DbSchema> {
    throw new Error('Method not implemented.');
  }

  getCollectionSchema(_db: DbRef): Observable<CollectionSchema> {
    throw new Error('Method not implemented.');
  }

  deleteRows(_db: DbRef, _collection: string, _ids: string): Observable<void> {
    throw new Error('Method not implemented.');
  }

  addRows(_db: DbRef, _collection: string, _rows: Row[]): Observable<void> {
    throw new Error('Method not implemented.');
  }

  getRecord(_collection: string, _id: string): unknown {
    throw new Error('not implemented yet')
  }

  getViewData(collectionId: string, view: string): Observable<Row[]> {
    return this.schema$.pipe(
      mergeMap(schema => {
        const collection = schema.collections.find(c => c.id == collectionId)
        if (!collection) {
          return throwError(() => 'unknown collection: ' + collectionId);
        }
        return this.repoClient.getFile<Row[]>(this.db, `${collection.path}/${view}.json`)
      })
    );
  }
}
