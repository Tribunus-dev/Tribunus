import { initCockpit } from "./index"

// For testing purposes before PGlite is wired up in the main app
// we pass a dummy object. Real initialization will be passed an instance.
const dummyPg = {
  query: async () => ({ rows: [] }),
  live: {
    query: () => ({
      unsubscribe: () => {},
    }),
  },
}

void initCockpit(dummyPg)
