const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs').promises;
const path = require('path');
const CompanyChatbot = require('./chatbot/bot');
const mongoose = require('mongoose');
const Chat = require('./models/chat');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {}).then(() => {
    console.log('Connected to MongoDB');
}).catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
});

// Initialize chatbot
const chatbot = new CompanyChatbot(process.env.OPENAI_API_KEY);

// Load and process documents
async function loadDocuments() {
    const docs = [];
    const docsPath = path.join(__dirname, 'data', 'company_docs');

    try {
        await fs.mkdir(docsPath, { recursive: true });
        console.log(`Created documents directory at ${docsPath}`);

        const files = await fs.readdir(docsPath);
        for (const file of files) {
            if (file.endsWith('.txt') || file.endsWith('.md')) {
                try {
                    const content = await fs.readFile(path.join(docsPath, file), 'utf-8');
                    docs.push(content);
                    console.log(`Loaded document: ${file}`);
                } catch (error) {
                    console.error(`Error loading ${file}:`, error);
                }
            }
        }
    } catch (error) {
        console.error('Error loading documents:', error);
    }

    return docs;
}

// Initialize documents at startup
(async () => {
    try {
        const docs = await loadDocuments();
        if (docs.length > 0) {
            const numChunks = await chatbot.processDocuments(docs);
            console.log(`Processed ${docs.length} documents into ${numChunks} chunks`);
        } else {
            console.warn('No documents found to process');
        }
    } catch (error) {
        console.error('Error initializing chatbot:', error);
        process.exit(1);
    }
})();

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, conversation_id } = req.body;

        if (!message) {
            return res.status(400).json({
                status: 'error',
                message: 'No message provided in request'
            });
        }

        let history = [];
        if (conversation_id) {
            const chat = await Chat.findOne({ conversation_id });
            if (chat) {
                history = chat.messages.map(msg => ({
                    type: msg.role,
                    content: msg.content
                }));
            }
        }

        const response = await chatbot.handleCustomerRequest(message, history, conversation_id);

        return res.json({
            status: 'success',
            response: response.content,
            conversation_id: response.conversation_id,
            timestamp: response.timestamp
        });

    } catch (error) {
        console.error('Error processing chat request:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        initialized: chatbot.isInitialized
    });
});

// Get chat history endpoint
app.get('/api/chat/:conversation_id', async (req, res) => {
    try {
        const chat = await Chat.findOne({ conversation_id: req.params.conversation_id });
        if (!chat) {
            return res.status(404).json({
                status: 'error',
                message: 'Conversation not found'
            });
        }

        return res.json({
            status: 'success',
            chat
        });
    } catch (error) {
        console.error('Error retrieving chat history:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

// Get all conversations endpoint
app.get('/api/chats', async (req, res) => {
    try {
        const chats = await Chat.find({}, {
            conversation_id: 1,
            created_at: 1,
            updated_at: 1,
            'messages.0.content': 1 // Get first message for preview
        }).sort({ updated_at: -1 });

        return res.json({
            status: 'success',
            chats
        });
    } catch (error) {
        console.error('Error retrieving chats:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Server starting on port ${PORT}`);
}); 