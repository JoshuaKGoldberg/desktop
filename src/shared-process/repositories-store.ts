import Dexie from 'dexie'
import Database from './database'
import Owner from '../models/owner'
import GitHubRepository from '../models/github-repository'
import Repository from '../models/repository'

// NB: We can't use async/await within Dexie transactions. This is because Dexie
// uses its own Promise implementation and TypeScript doesn't know about it. See
// https://github.com/dfahlander/Dexie.js/wiki/Typescript#async-and-await, but
// note that their proposed work around doesn't seem to, you know, work, as of
// TS 1.8.
//
// Instead of using async/await, use generator functions and `yield`.

function deDexie<T>(promise: Dexie.Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    promise.then(resolve, reject)
  })
}

/** The store for local repositories. */
export default class RepositoriesStore {
  private db: Database

  public constructor(db: Database) {
    this.db = db
  }

  /** Get all the local repositories. */
  public async getRepositories(): Promise<Repository[]> {
    const inflatedRepos: Repository[] = []
    const db = this.db
    const transaction = this.db.transaction('r', this.db.repositories, this.db.gitHubRepositories, this.db.owners, function*(){
      const repos = yield db.repositories.toArray()
      for (const repo of repos) {
        let inflatedRepo: Repository = null
        if (repo.gitHubRepositoryID) {
          const gitHubRepository = yield db.gitHubRepositories.get(repo.gitHubRepositoryID)
          const owner = yield db.owners.get(gitHubRepository.ownerID)
          inflatedRepo = new Repository(repo.path, new GitHubRepository(gitHubRepository.name, new Owner(owner.login, owner.endpoint)))
        } else {
          inflatedRepo = new Repository(repo.path, null)
        }
        inflatedRepos.push(inflatedRepo)
      }
    })

    await deDexie(transaction)

    return inflatedRepos
  }

  /** Add a new local repository. */
  public async addRepository(repo: Repository): Promise<void> {
    const db = this.db
    const transaction = this.db.transaction('rw', this.db.repositories, this.db.gitHubRepositories, this.db.owners, function*() {
      let gitHubRepositoryID: number = null
      const gitHubRepository = repo.getGitHubRepository()
      if (gitHubRepository) {
        const login = gitHubRepository.getOwner().getLogin()
        const existingOwner = yield db.owners.where('login').equalsIgnoreCase(login).limit(1).first()
        let ownerID: number = null
        if (existingOwner) {
          ownerID = existingOwner.id
        } else {
          ownerID = yield db.owners.add({login, endpoint: gitHubRepository.getOwner().getEndpoint()})
        }

        gitHubRepositoryID = yield db.gitHubRepositories.add({
          name: gitHubRepository.getName(),
          ownerID
        })
      }

      yield db.repositories.add({
        path: repo.getPath(),
        gitHubRepositoryID
      })
    })

    await deDexie(transaction)
  }
}