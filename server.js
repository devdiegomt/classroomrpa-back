require('dotenv').config();

const archiver = require('archiver');
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();

const oauth2Client =
    new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

function loadSavedTokens() {

    if (!process.env.GOOGLE_REFRESH_TOKEN) {
        throw new Error(
            'GOOGLE_REFRESH_TOKEN is missing'
        );
    }

    oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
}

const SCOPES = [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.topics.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
    'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
    'https://www.googleapis.com/auth/classroom.rosters.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
];

app.use(cors());

app.get('/', (req, res) => {

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES
    });

    res.send(`
    <h1>Google Classroom RPA</h1>
    <a href="${authUrl}">
      Login with Google
    </a>
  `);
});

app.get('/courses', async (req, res) => {

    try {

        loadSavedTokens();

        const classroom = google.classroom({
            version: 'v1',
            auth: oauth2Client
        });

        const response =
            await classroom.courses.list({
                teacherId: 'me'
            });

        const courses = response.data.courses || [];

        res.json(courses);

    } catch (error) {

        console.error(error);

        res.status(500).send(error.message);
    }
});

app.get('/courses/:id/topics', async (req, res) => {

    try {

        loadSavedTokens();

        const classroom = google.classroom({
            version: 'v1',
            auth: oauth2Client
        });

        const courseId = req.params.id;

        const response =
            await classroom.courses.topics.list({
                courseId
            });

        const topics = response.data.topic || [];

        res.json(topics);

    } catch (error) {

        console.error(error);

        res.status(500).send(error.message);
    }
});

app.get(
    '/courses/:courseId/topics/:topicId/coursework',
    async (req, res) => {

        try {

            loadSavedTokens();

            const classroom = google.classroom({
                version: 'v1',
                auth: oauth2Client
            });

            const { courseId, topicId } = req.params;

            const response =
                await classroom.courses.courseWork.list({
                    courseId
                });

            const allCoursework =
                response.data.courseWork || [];

            const filteredCoursework =
                allCoursework.filter(work =>
                    work.topicId === topicId
                );

            res.json(filteredCoursework);

        } catch (error) {

            console.error(error);

            res.status(500).send(error.message);
        }
    });

app.get(
    '/courses/:courseId/coursework/:courseWorkId/submissions',
    async (req, res) => {

        try {

            loadSavedTokens();

            const classroom = google.classroom({
                version: 'v1',
                auth: oauth2Client
            });

            const { courseId, courseWorkId } = req.params;

            const response =
                await classroom.courses.courseWork.studentSubmissions.list({
                    courseId,
                    courseWorkId
                });

            const submissions =
                response.data.studentSubmissions || [];

            const simplified = submissions.map(submission => {

                const attachments =
                    submission.assignmentSubmission?.attachments || [];

                return {
                    submissionId: submission.id,
                    userId: submission.userId,
                    state: submission.state,
                    attachments
                };
            });

            res.json(simplified);

        } catch (error) {

            console.error(error);

            res.status(500).send(error.message);
        }
    });

app.get(
    '/courses/:courseId/students',
    async (req, res) => {

        try {

            loadSavedTokens();

            const classroom = google.classroom({
                version: 'v1',
                auth: oauth2Client
            });

            const { courseId } = req.params;

            const response =
                await classroom.courses.students.list({
                    courseId
                });

            const students =
                response.data.students || [];

            const simplified = students.map(student => ({
                userId: student.userId,
                name: student.profile.name.fullName,
                email: student.profile.emailAddress
            }));

            res.json(simplified);

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error: error.message
            });
        }
    });

app.get(
    '/courses/:courseId/coursework/:courseWorkId/download-all',
    async (req, res) => {

        try {

            loadSavedTokens();

            const classroom = google.classroom({
                version: 'v1',
                auth: oauth2Client
            });

            const drive = google.drive({
                version: 'v3',
                auth: oauth2Client
            });

            const { courseId, courseWorkId } = req.params;

            // =========================
            // GET STUDENTS
            // =========================

            const studentsResponse =
                await classroom.courses.students.list({
                    courseId
                });

            const students =
                studentsResponse.data.students || [];

            const studentMap = {};

            for (const student of students) {

                studentMap[student.userId] = {
                    name: student.profile.name.fullName
                };
            }

            // =========================
            // GET SUBMISSIONS
            // =========================

            const submissionsResponse =
                await classroom.courses.courseWork
                    .studentSubmissions.list({
                        courseId,
                        courseWorkId
                    });

            const submissions =
                submissionsResponse.data.studentSubmissions || [];

            // =========================
            // ZIP
            // =========================

            const archive = archiver('zip', {
                zlib: { level: 9 }
            });

            const zipName =
                `coursework-${courseWorkId}.zip`;

            res.setHeader(
                'Content-Type',
                'application/zip'
            );

            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${zipName}"`
            );

            archive.pipe(res);

            // =========================
            // PROCESS FILES
            // =========================

            for (const submission of submissions) {

                const studentInfo =
                    studentMap[submission.userId];

                const studentName =
                    studentInfo?.name ||
                    `student-${submission.userId}`;

                const safeStudentName =
                    studentName.replace(
                        /[<>:"/\\\\|?*]/g,
                        '_'
                    );

                const attachments =
                    submission.assignmentSubmission
                        ?.attachments || [];

                for (const attachment of attachments) {

                    if (!attachment.driveFile) continue;

                    const fileId =
                        attachment.driveFile.id;

                    const originalFileName =
                        attachment.driveFile.title;

                    const safeFileName =
                        originalFileName.replace(
                            /[<>:"/\\\\|?*]/g,
                            '_'
                        );

                    console.log(
                        `Downloading ${safeStudentName}/${safeFileName}`
                    );

                    try {

                        const responseStream =
                            await drive.files.get(
                                {
                                    fileId,
                                    alt: 'media'
                                },
                                {
                                    responseType: 'stream'
                                }
                            );

                        archive.append(
                            responseStream.data,
                            {
                                name: `${safeStudentName}/${safeFileName}`
                            }
                        );

                    } catch (fileError) {

                        console.error(
                            'Error downloading:',
                            safeFileName,
                            fileError.message
                        );
                    }
                }
            }

            await archive.finalize();

        } catch (error) {

            console.error(error);

            if (!res.headersSent) {

                res.status(500).json({
                    error: error.message
                });
            }
        }
    }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `Server running on port ${PORT}`
    );
});