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

      // Generate prompt for Gemini API
      const prompt = `Based on the content ${textContent}, provide a JSON object with the following keys and their corresponding values, extracted from the text:

      - PAN (if available)
      - Date
      - DIN
      - Address
      - AssessmentYear
      - Sections
      - Annexure`;

      // Call Gemini API
      const extractedData = await generateGeminiResponse(prompt);
      console.log("extractedData", extractedData);
      const cleanedData = extractedData.replace(/```json|```/g, "");
      console.log("cleanedData", cleanedData);

      const jsonData = JSON.parse(cleanedData);
      console.log("jsonData", jsonData);
      const { Address, PAN, AssessmentYear, DIN, Date, Sections, Annexure } =
        jsonData;

      // Create PAN directory inside month-year directory
      const panDir = path.join(uploadBaseDir, `${monthDir}/${PAN}`);
      if (!fs.existsSync(panDir)) {
        fs.mkdirSync(panDir, { recursive: true });
        console.log(`Created PAN directory at ${panDir}`);
      }

      // Move the uploaded file to the PAN directory
      const newFilePath = path.join(panDir, `notice_${file.originalname}`);
      fs.renameSync(file.path, newFilePath);
      const fileType = "notice";
      db.run(
        `INSERT INTO Notice (pan_number, date, din_number, address, sections, assessment_year, annexure, fileLocation, fileType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ],
        function (err) {
          if (err) {
            return res.status(400).json({ error: err.message });
          }
          res.status(200).json({
            success: true,
            message: "Notice file uploaded and data extracted successfully",
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
            },
          });
        }
      );
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }
);

// UPLOAD REPLY

// app.post(
//   "/api/v1/upload-reply",
//   upload.single("reply-file"),
//   async (req, res) => {
//     const file = req.file;
//     if (!file) {
//       return res.status(400).json({ error: "No file uploaded" });
//     }

//     try {
//       const buffer = fs.readFileSync(file.path);
//       const parsedData = await pdfParse(buffer);
//       const textContent = parsedData.text;

//       // Generate prompt for Gemini API
//       const prompt = `Based on the Reply content ${textContent} from client to the notice given by department, Generate a  JSON object with the following keys and their corresponding values, extracted from the reply given by client Keys as mentioned below.:
//       - PAN (if available)
//       - Date as Reply_Date
//       - Subject
//       - DIN  (If Available)
//       - Reply From
//       - AssessmentYear
//       - Sections
//       - Reply Email
//       - Reply Mobile
//       - Reply Content generate summary of each point`;

//       // Call Gemini API
//       const extractedData = await generateGeminiResponse(prompt);
//       console.log("extractedData", extractedData);
//       const cleanedData = extractedData.replace(/```json|```/g, "");

//       console.log("cleanedData", cleanedData);

//       const jsonData = JSON.parse(cleanedData);
//       console.log("jsonData", jsonData);
//       const { Address, PAN, AssessmentYear, DIN, Date, Sections } = jsonData;

//       // Create PAN directory inside month-year directory
//       const panDir = path.join(uploadBaseDir, `${monthDir}/${PAN}`);
//       if (!fs.existsSync(panDir)) {
//         fs.mkdirSync(panDir, { recursive: true });
//         console.log(`Created PAN directory at ${panDir}`);
//       }

//       // Move the uploaded file to the PAN directory
//       const newFilePath = path.join(panDir, file.originalname);
//       fs.renameSync(file.path, newFilePath);
//       const fileType = "reply";
//       // db.run(
//       //   `INSERT INTO Notice (pan_number, date, din_number, address, sections, assessment_year, fileLocation, fileType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//       //   [
//       //     PAN,
//       //     Date,
//       //     DIN,
//       //     Address,
//       //     Sections,
//       //     AssessmentYear,
//       //     newFilePath,
//       //     fileType,
//       //   ],
//       //   function (err) {
//       //     if (err) {
//       //       return res.status(400).json({ error: err.message });
//       //     }
//       //     res.status(200).json({
//       //       success: true,
//       //       message: "reply file uploaded and data extracted successfully",
//       //       data: {
//       //         PAN,
//       //         Date,
//       //         DIN,
//       //         Address,
//       //         Sections,
//       //         AssessmentYear,
//       //         newFilePath,
//       //         fileType,
//       //       },
//       //     });
//       //   }
//       // );
//     } catch (error) {
//       console.log(error);
//       res.status(400).json({ error: error.message });
//     }
//   }
// );

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

      // Generate prompt for Gemini API
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
      - Reply_Content generate summary of each point and store in array`;

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
        `SELECT id, date FROM Notice WHERE pan_number = ? ORDER BY date DESC LIMIT 1`,
        [PAN],
        (err, notice) => {
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

          // Create PAN directory inside month-year directory
          const panDir = path.join(uploadBaseDir, `${monthDir}/${PAN}`);
          if (!fs.existsSync(panDir)) {
            fs.mkdirSync(panDir, { recursive: true });
            console.log(`Created PAN directory at ${panDir}`);
          }

          // Move the uploaded file to the PAN directory
          const newFilePath = path.join(panDir, `reply_${file.originalname}`);
          fs.renameSync(file.path, newFilePath);
          const fileType = "reply";

          // Insert reply data into Reply table
          db.run(
            `INSERT INTO Reply (pan_number, notice_id, notice_date, reply_date, subject, assessment_year, reply_from, reply_email, reply_mobile, reply_content, fileLocation, fileType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              JSON.stringify(Reply_Content),
              newFilePath,
              fileType,
            ],
            function (err) {
              if (err) {
                return res.status(400).json({ error: err.message });
              }
              res.status(200).json({
                success: true,
                message: "Reply file uploaded and data extracted successfully",
                data: {
                  PAN,
                  noticeId,
                  noticeDate,
                  Reply_Date,
                  Subject,
                  AssessmentYear,
                  Reply_From,
                  Reply_Email,
                  Reply_Mobile,
                  Reply_Content,
                  newFilePath,
                  fileType,
                },
              });
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

function parseJSON(jsonString) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error("Error parsing JSON:", error);
    return null; // Return null if parsing fails
  }
}

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
