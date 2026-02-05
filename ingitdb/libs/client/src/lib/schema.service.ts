import {Injectable} from '@angular/core';
import {DbSchema} from '@ingitdb/schema';
import {Observable} from 'rxjs';
import {DbRef} from './repo-client.interface';
import {RepoClientFactoryService} from './repo-client-factory.service';

@Injectable({
  providedIn: 'root'
})
export class SchemaService {

  constructor(
    private readonly clientFactory: RepoClientFactoryService,
  ) {
  }

  getSchema(db: DbRef): Observable<DbSchema> {
    const client = this.clientFactory.getRepoClient(db.host);
    return client.getFile<DbSchema>(db, '.ingitdb/schema.json');
  }
}

