const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const cors = require("cors");
const pdfParse = require("pdf-parse");
const sqlite3 = require("sqlite3").verbose();
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const today = new Date();
const month = today.toLocaleString("default", { month: "long" });
const year = today.getFullYear();
const monthDir = `${month}-${year}`;

const uploadBaseDir = path.join(__dirname, "./file");

if (!fs.existsSync(uploadBaseDir)) {
  fs.mkdirSync(uploadBaseDir, { recursive: true });
  console.log(`Created base upload directory at ${uploadBaseDir}`);
}

const upload = multer({ dest: uploadBaseDir });

const db = new sqlite3.Database("tax_reply.db");

const port = process.env.PORT || 3000;

// UPLOAD NOTICE

app.post(
  "/api/v1/upload-notice",
  upload.single("notice-file"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const buffer = fs.readFileSync(file.path);
      const parsedData = await pdfParse(buffer);
      const textContent = parsedData.text;
      const fileName = file.originalname;

      // Extract Date and DIN from textContent using regex
      const dateMatch = textContent.match(
        /(?:Dated|Date|date):?\s*([0-9]{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+[0-9]{4}|[0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{4})/i
      );
      const dinMatch = textContent.match(
        /(?:DIN|din(?: & Letter No| & Letter-No| and Letter No)?):\s*([A-Z0-9/()\-]+)/i
      );

      const Date = dateMatch ? dateMatch[1] : null;
      const DIN = dinMatch ? dinMatch[1] : null;

      // Check for existing notice by fileName
      db.get(
        `SELECT * FROM Notice WHERE fileName = ?`,
        [fileName],
        async (err, row) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          if (row) {
            // Notice already exists, return existing data
            fs.unlinkSync(file.path); // Remove the uploaded file from the file directory
            return res.status(200).json({
              success: true,
              message: "Notice already exists.",
              data: row,
            });
          }

          // Check for existing notice by DIN and Date
          db.get(
            `SELECT * FROM Notice WHERE date = ? OR din_number = ?`,
            [Date, DIN],
            async (err, row) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              if (row) {
                // Notice already exists, return existing data
                fs.unlinkSync(file.path);
                return res.status(200).json({
                  success: true,
                  message: "Notice already exists",
                  data: row,
                });
              }

              // Check for existing notice by textContent
              db.get(
                `SELECT * FROM Notice WHERE textContent = ?`,
                [textContent],
                async (err, row) => {
                  if (err) {
                    return res.status(500).json({ error: err.message });
                  }

                  if (row) {
                    // Notice already exists, return existing data
                    fs.unlinkSync(file.path);
                    return res.status(200).json({
                      success: true,
                      message: "Notice already exists",
                      data: row,
                    });
                  }

                  // Proceed with processing the file as it doesn't exist in the database
                  const prompt = `Based on the content ${textContent}, provide a JSON object with the following keys and their corresponding values, extracted from the text:
                  - PAN (if available)
                  - Date
                  - DIN
                  - Address
                  - AssessmentYear
                  - Sections
                  - Annexure generate all accounts or documents or information is required by income tax in array
                   Each question in the Annexure array should be a string clearly describing the information required`;

                  // Call Gemini API
                  const extractedData = await generateGeminiResponse(prompt);
                  console.log("extractedData", extractedData);
                  const cleanedData = extractedData.replace(/```json|```/g, "");
                  console.log("cleanedData", cleanedData);

                  const jsonData = JSON.parse(cleanedData);
                  console.log("jsonData", jsonData);
                  const {
                    Address,
                    PAN,
                    AssessmentYear,
                    DIN,
                    Date,
                    Sections,
                    Annexure,
                  } = jsonData;

                  // Create PAN directory inside month-year directory
                  const panDir = path.join(uploadBaseDir, `${monthDir}/${PAN}`);
                  if (!fs.existsSync(panDir)) {
                    fs.mkdirSync(panDir, { recursive: true });
                    console.log(`Created PAN directory at ${panDir}`);
                  }

                  // Move the uploaded file to the PAN directory
                  const newFilePath = path.join(
                    panDir,
                    `notice_${file.originalname}`
                  );
                  fs.renameSync(file.path, newFilePath);
                  const fileType = "notice";

                  db.run(
                    `INSERT INTO Notice (pan_number, date, din_number, address, sections, assessment_year, annexure, fileLocation, fileType, fileName, textContent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      PAN,
                      Date,
                      DIN,
                      Address,
                      JSON.stringify(Sections),
                      AssessmentYear,
                      JSON.stringify(Annexure),
                      newFilePath,
                      fileType,
                      fileName,
                      textContent,
                    ],
                    function (err) {
                      if (err) {
                        return res.status(400).json({ error: err.message });
                      }
                      res.status(200).json({
                        success: true,
                        message:
                          "Notice file uploaded and data extracted successfully",
                        data: {
                          PAN,
                          Date,
                          DIN,
                          Address,
                          Sections,
                          AssessmentYear,
                          Annexure,
                          newFilePath,
                          fileType,
                          fileName,
                          textContent,
                        },
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }
);

// UPLOAD REPLY

app.post(
  "/api/v1/upload-reply",
  upload.single("reply-file"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const buffer = fs.readFileSync(file.path);
      const parsedData = await pdfParse(buffer);
      const textContent = parsedData.text;
      const fileName = file.originalname;

      // Check if reply with the same fileName already exists in the database
      db.get(
        `SELECT * FROM Reply WHERE fileName = ?`,
        [fileName],
        async (err, row) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          if (row) {
            // Reply already exists, return existing data
            fs.unlinkSync(file.path); // Remove the uploaded file from the file directory
            return res.status(200).json({
              success: true,
              message: "Reply already exists",
              data: row,
            });
          }

          // Check if reply with the same textContent already exists in the database
          db.get(
            `SELECT * FROM Reply WHERE textContent = ?`,
            [textContent],
            async (err, row) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              if (row) {
                // Reply already exists, return existing data
                fs.unlinkSync(file.path); // Remove the uploaded file from the file directory
                return res.status(200).json({
                  success: true,
                  message: "Reply already exists",
                  data: row,
                });
              }

              // Proceed with processing the file as it doesn't exist in the database
              const prompt = `Based on the Reply content ${textContent} from client to the notice given by department, Generate a JSON object with the following keys and their corresponding values, extracted from the reply given by client Keys as mentioned below:
              - PAN (if available)
              - Date as Reply_Date
              - Subject
              - DIN (If Available)
              - Reply_From 
              - AssessmentYear
              - Sections
              - Reply_Email 
              - Reply_Mobile 
              - Reply_Content generate summary of each point in array`;

              // Call Gemini API
              const extractedData = await generateGeminiResponse(prompt);
              console.log("extractedData", extractedData);
              const cleanedData = extractedData.replace(/```json|```/g, "");
              console.log("cleanedData", cleanedData);

              const jsonData = JSON.parse(cleanedData);
              console.log("jsonData", jsonData);
              const {
                PAN,
                Reply_Date,
                Subject,
                AssessmentYear,
                Reply_From,
                Reply_Email,
                Reply_Mobile,
                Reply_Content,
              } = jsonData;

              // Find the corresponding notice_id using PAN number
              db.get(
                `SELECT id, date, annexure FROM Notice WHERE pan_number = ? ORDER BY date DESC LIMIT 1`,
                [PAN],
                async (err, notice) => {
                  if (err) {
                    return res.status(500).json({ error: err.message });
                  }

                  if (!notice) {
                    return res
                      .status(404)
                      .json({ error: "Corresponding notice not found" });
                  }

                  const noticeId = notice.id;
                  const noticeDate = notice.date;
                  const annexure = JSON.parse(notice.annexure);

                  // Create PAN directory inside month-year directory
                  const panDir = path.join(uploadBaseDir, `${monthDir}/${PAN}`);
                  if (!fs.existsSync(panDir)) {
                    fs.mkdirSync(panDir, { recursive: true });
                    console.log(`Created PAN directory at ${panDir}`);
                  }

                  // Move the uploaded file to the PAN directory
                  const newFilePath = path.join(
                    panDir,
                    `reply_${file.originalname}`
                  );
                  fs.renameSync(file.path, newFilePath);
                  const fileType = "reply";

                  // Compare Annexure questions with client responses and prepare summary
                  const summary = annexure
                    .map((question, index) => {
                      const response = Reply_Content[index];
                      return response
                        ? `Question: ${question}\nClient Response: ${response}`
                        : `Question: ${question}\nClient Response: Not responded`;
                    })
                    .join("\n\n");

                  // Generate final opinion using Gemini API
                  const finalOpinionPrompt = `Based on the Notice questions and the client's responses, generate a final opinion after comparing the notice questions and client replies, highlighting unanswered questions and summarizing the responses point by point, and list the  relevant evidences for unanswered questions. Gemerate total reply in max 1000 words, or summery.
                Notice Questions: ${JSON.stringify(annexure)}
                Client Responses: ${JSON.stringify(jsonData.Reply_Content)}`;

                  const finalOpinion = await generateGeminiResponse(
                    finalOpinionPrompt
                  );

                  // Insert reply data into Reply table
                  db.run(
                    `INSERT INTO Reply (pan_number, notice_id, notice_date, reply_date, subject, assessment_year, reply_from, reply_email, reply_mobile, reply_content, fileLocation, fileType, finalOpinion, fileName, textContent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      PAN,
                      noticeId,
                      noticeDate,
                      Reply_Date,
                      Subject,
                      AssessmentYear,
                      Reply_From,
                      Reply_Email,
                      Reply_Mobile,
                      JSON.stringify(summary),
                      newFilePath,
                      fileType,
                      finalOpinion,
                      fileName,
                      textContent,
                    ],
                    function (err) {
                      if (err) {
                        return res.status(500).json({ error: err.message });
                      }
                      res.status(200).json({
                        success: true,
                        message:
                          "Reply file uploaded, data extracted and summarized successfully",
                        data: {
                          PAN,
                          Reply_Date,
                          Subject,
                          AssessmentYear,
                          Reply_From,
                          Reply_Email,
                          Reply_Mobile,
                          summary,
                          newFilePath,
                          fileType,
                          finalOpinion,
                          fileName,
                          textContent,
                        },
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }
);

// See all Notice

app.get("/api/v1/all-notice", (req, res) => {
  db.all("SELECT * FROM Notice", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const notices = rows.map((row) => {
      try {
        return {
          ...row,
          sections: JSON.parse(row.sections),
          annexure: JSON.parse(row.annexure),
        };
      } catch (error) {
        console.error("Error parsing JSON:", error);
        return {
          ...row,
        };
      }
    });
    res.status(200).json({ notices });
  });
});

// total case

app.get("/api/v1/total-case", (req, res) => {
  db.all("SELECT * FROM Notice", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    try {
      const notices = rows.map((row) => row.pan_number);
      const total_case = new Set(notices);

      return res.status(200).json({
        success: true,
        message: "Total case fetch successfully",
        data: total_case.size,
      });
    } catch (error) {
      console.log("Error in total case", error);
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  });
});

// pending case

app.get("/api/v1/pending-case", (req, res) => {
  db.all(`SELECT * FROM Notice WHERE status = 'open'`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    try {
      const notices = rows.map((row) => row.pan_number);
      const total_case = new Set(notices);
      return res.status(200).json({
        success: true,
        message: "Total case fetch successfully",
        data: total_case.size,
      });
    } catch (error) {
      console.log("Error in total case", error);
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  });
});

// Response

app.post("/api/v1/response", async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) {
      return res.status(400).send({ error: "Missing data in request body" });
    }

    // Assuming geminiGenerate is a function that takes input data and returns a generated prompt

    const prompt = await generateGeminiResponse(data);

    res.status(200).send({ prompt });
  } catch (error) {
    console.error("Error generating response:", error);
    res.status(500).send({ error: "Failed to generate prompt" });
  }
});

// all Reply

app.get("/api/v1/all-reply", (req, res) => {
  db.all("SELECT * FROM Reply", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const reply = rows.map((row) => {
      try {
        return {
          ...row,
          reply_content: JSON.parse(row.reply_content),
        };
      } catch (error) {
        console.error("Error parsing JSON:", error);
        return {
          ...row,
        };
      }
    });
    res.status(200).json({ reply });
  });
});

// Endpoint to close a case

app.post("/api/v1/close-case", (req, res) => {
  const { pan_number } = req.body;

  if (!pan_number) {
    return res.status(400).json({ error: "PAN number is required" });
  }

  db.serialize(() => {
    db.run(
      `UPDATE Notice SET status = 'closed' WHERE pan_number = ?`,
      [pan_number],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: "Notice not found" });
        }

        console.log("Notice status updated to closed");
      }
    );

    db.run(
      `UPDATE Reply SET status = 'closed' WHERE pan_number = ?`,
      [pan_number],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: "Reply not found" });
        }

        res.status(200).json({ message: "Case closed successfully" });
      }
    );
  });
});

// Endpoint to open a case
app.post("/api/v1/open-case", (req, res) => {
  const { pan_number } = req.body;

  if (!pan_number) {
    return res.status(400).json({ error: "PAN number is required" });
  }

  db.serialize(() => {
    db.run(
      `UPDATE Notice SET status = 'open' WHERE pan_number = ?`,
      [pan_number],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: "Notice not found" });
        }

        console.log("Notice status updated to open");
      }
    );

    db.run(
      `UPDATE Reply SET status = 'open' WHERE pan_number = ?`,
      [pan_number],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: "Reply not found" });
        }

        res.status(200).json({ message: "Case reopened successfully." });
      }
    );
  });
});

// Endpoint to fetch a single document by id
app.get("/api/v1/all-notice/:id", (req, res) => {
  const documentId = req.params.id;
  const sql = "SELECT * FROM Notice WHERE id = ?";

  db.get(sql, [documentId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Parse JSON fields if they exist
    try {
      // const document = {
      //   ...row,
      //   sections: JSON.parse(row.sections),
      //   annexure: JSON.parse(row.annexure),
      // };

      res.status(200).json({ document: row });
    } catch (error) {
      console.error("Error parsing JSON:", error);
      res.status(500).json({ error: "Error retrieving document" });
    }
  });
});

// Delete a notice by ID
app.delete("/api/v1/notice/:id", (req, res) => {
  const docId = req.params.id;

  db.run(`DELETE FROM Notice WHERE id = ?`, docId, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "Notice not found" });
    }

    res.status(200).json({ message: "Notice deleted successfully" });
  });
});

// delete all notices
app.delete("/api/v1/notice", (req, res) => {
  db.run(`DELETE FROM Notice`, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Check if any rows were affected
    if (this.changes === 0) {
      return res.status(404).json({ error: "No notices found" });
    }

    res.status(200).json({ message: "All notices deleted successfully" });
  });
});

// delete all reply
app.delete("/api/v1/reply", (req, res) => {
  db.run(`DELETE FROM Reply`, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Check if any rows were affected
    if (this.changes === 0) {
      return res.status(404).json({ error: "No Reply found" });
    }

    res.status(200).json({ message: "All reply deleted successfully" });
  });
});

// Delete a Reply by ID
app.delete("/api/v1/reply/:id", (req, res) => {
  const docId = req.params.id;

  db.run(`DELETE FROM Reply WHERE id = ?`, docId, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "Reply not found" });
    }

    res.status(200).json({ message: "Reply deleted successfully" });
  });
});

// Endpoint to update a document by id
app.put("/api/v1/notice/:id", (req, res) => {
  const documentId = req.params.id;
  const updateFields = req.body;

  // Construct the SET clause dynamically based on the fields in the request body
  const setClause = Object.keys(updateFields)
    .map((key) => `${key} = ?`)
    .join(", ");
  const values = Object.values(updateFields);
  values.push(documentId); // Add documentId to the end of the array for WHERE clause

  const sql = `
    UPDATE Notice 
    SET ${setClause}
    WHERE id = ?
  `;

  db.run(sql, values, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ message: "Document not found" });
    }

    res
      .status(200)
      .json({ message: "Document updated successfully", data: values });
  });
});

async function generateGeminiResponse(prompt) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    console.error("Error generating response:", error);
    throw new Error("Error generating response");
  }
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
