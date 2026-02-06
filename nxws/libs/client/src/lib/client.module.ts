import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import {GithubRepoService} from './repo-client.github.service';
import {SchemaService} from './schema.service';

@NgModule({
  imports: [CommonModule],
  providers: [
    GithubRepoService,
    SchemaService,
  ]
})
export class ClientModule {}
