import type { Collection, Store } from '@emulators/core'
import type {
  FirebaseMessage,
  FirebaseOobCode,
  FirebaseProject,
  FirebaseToken,
  FirebaseUser,
} from './entities.js'

export interface FirebaseStore {
  projects: Collection<FirebaseProject>
  users: Collection<FirebaseUser>
  tokens: Collection<FirebaseToken>
  messages: Collection<FirebaseMessage>
  oobCodes: Collection<FirebaseOobCode>
}

export function getFirebaseStore(store: Store): FirebaseStore {
  return {
    projects: store.collection<FirebaseProject>('firebase.projects', ['project_id', 'api_key']),
    users: store.collection<FirebaseUser>('firebase.users', ['local_id', 'email']),
    tokens: store.collection<FirebaseToken>('firebase.tokens', ['id_token', 'refresh_token']),
    messages: store.collection<FirebaseMessage>('firebase.messages', ['message_id']),
    oobCodes: store.collection<FirebaseOobCode>('firebase.oob_codes', ['oob_code']),
  }
}
