import {Injectable} from '@angular/core';
import {IngitDbSchema} from '@ingitdb/schema';
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

  getSchema(db: DbRef): Observable<IngitDbSchema> {
    const client = this.clientFactory.getRepoClient(db.host);
    return client.getRaw<IngitDbSchema>(db, '.ingitdb/schema.json');
  }
}

