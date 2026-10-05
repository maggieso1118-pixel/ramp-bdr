import { openDatabase } from "../lib/db/database.ts";
import { prepareCommercialLikelihood } from "../lib/likelihood/prepare.ts";

const db = openDatabase();
try {
  const result = prepareCommercialLikelihood(db, count => console.log(`${count.toLocaleString()} candidates scored`));
  console.log(JSON.stringify(result, null, 2));
} finally { db.close(); }
