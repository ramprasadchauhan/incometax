const sqlite3 = require("sqlite3").verbose();

// Connect to SQLite database
const db = new sqlite3.Database("tax_reply.db");

db.serialize(() => {
  // Drop the Notice table if it exists (optional, if you need to reset the table)
  db.run(`DROP TABLE IF EXISTS Notice`);

  // Create Notice table
  db.run(`
    CREATE TABLE Notice (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pan_number TEXT,
      date TEXT,
      din_number TEXT,
      address TEXT,
      sections TEXT,
      assessment_year TEXT,
      fileLocation TEXT,
      fileType TEXT,
    )
  `);

  console.log("Notice table created successfully.");
});

// Close the database connection
db.close();
