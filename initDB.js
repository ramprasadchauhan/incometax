const sqlite3 = require("sqlite3").verbose();

// Connect to SQLite database
const db = new sqlite3.Database("tax_reply.db");

db.serialize(() => {
  // Drop the Notice table if it exists (optional, if you need to reset the table)
  // db.run(`DROP TABLE IF EXISTS Notice`);
  // db.run(`DROP TABLE IF EXISTS Reply`);

  // Create Notice table
  db.run(
    `CREATE TABLE Notice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pan_number TEXT,
    date TEXT,
    din_number TEXT,
    address TEXT,
    sections TEXT,
    assessment_year TEXT,
    annexure TEXT,
    fileLocation TEXT,
    fileType TEXT,
    status TEXT DEFAULT 'open'
  )`,
    (err) => {
      if (err) {
        console.error("Error creating Notice table:", err.message);
      } else {
        console.log("Notice table created successfully");
      }
    }
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS Reply (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pan_number TEXT,
    notice_id INTEGER,
    notice_date TEXT,
    reply_date TEXT,
    subject TEXT,
    assessment_year TEXT,
    reply_from TEXT,
    reply_email TEXT,
    reply_mobile TEXT,
    reply_content TEXT,
    fileLocation TEXT,
    fileType TEXT,
    status TEXT DEFAULT 'open',
    finalOpinion TEXT,
    FOREIGN KEY (notice_id) REFERENCES Notice(id)
  )`,
    (err) => {
      if (err) {
        console.error("Error creating Notice table:", err.message);
      } else {
        console.log("Reply table created successfully");
      }
    }
  );
});

// Close the database connection
db.close();
