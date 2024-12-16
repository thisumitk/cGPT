const { OpenAI } = require('openai');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { OpenAIEmbeddings } = require('langchain/embeddings/openai');
const { FaissStore } = require('langchain/vectorstores/faiss');
const { v4: uuidv4 } = require('uuid');
const Chat = require('../models/chat');

class CompanyChatbot {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('API key cannot be empty');
        }

        this.client = new OpenAI({ apiKey });
        this.embeddings = new OpenAIEmbeddings({ openAIApiKey: apiKey });
        this.vectorStore = null;
        this.isInitialized = false;
        this.model = 'gpt-4';
    }

    async processDocuments(documents) {
        if (!documents || documents.length === 0) {
            throw new Error('No documents provided');
        }

        // Convert strings to Document objects

        const docObjects = documents.map(text => ({
            pageContent: text,
            metadata: {}
        }));

        // Split documents into chunks
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
            separators: ['\n\n', '\n', '.', '!', '?', ',', ' ', '']
        });

        const chunks = await textSplitter.splitDocuments(docObjects);

        if (!chunks || chunks.length === 0) {
            throw new Error('No chunks created from documents');
        }

        // Create vector store
        this.vectorStore = await FaissStore.fromDocuments(chunks, this.embeddings);
        this.isInitialized = true;

        return chunks.length; // Return number of chunks for logging
    }

    async getRelevantContext(query, k = 3) {
        if (!this.isInitialized) {
            throw new Error('Chatbot not initialized. Please process documents first.');
        }

        if (!query.trim()) {
            throw new Error('Query cannot be empty');
        }

        const docs = await this.vectorStore.similaritySearch(query, k);
        return docs.map(doc => doc.pageContent).join('\n\n');
    }

    async handleCustomerRequest(message, conversationHistory = [], conversation_id = null) {
        let context = '';
        try {
            context = await this.getRelevantContext(message);
        } catch (error) {
            console.error('Error getting context:', error);
        }

        // Create the system message for context
        const systemMessage = {
            role: 'system',
            content: `You are a focused customer service representative. 
            Only answer questions related to the provided company information.
            If the question is unrelated to the company or the context doesn't contain relevant information, 
            politely say you can only help with company-related questions.
            use dialect and slang similar to the context and user when appropriate.
            Keep responses very short and concise.
            Use emojis when appropriate.
            Use response short, humanlike and concise.
            Use humor when appropriate.
            Be as human as possible.
            Company Context:
            ${context}`
        };

        // Format the conversation history
        const messages = [systemMessage];

        // Add conversation history
        conversationHistory.forEach(msg => {
            messages.push({
                role: msg.type === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        });

        // Add the current message
        messages.push({
            role: 'user',
            content: message
        });

        // Get response from OpenAI
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages,
            temperature: 0.7,
            max_tokens: 200,
            top_p: 0.9,
            frequency_penalty: 0.5,
            presence_penalty: 0.3
        });

        const responseContent = response.choices[0].message.content;
        const newConversationId = conversation_id || uuidv4();

        // Save to MongoDB
        try {
            const chat = await Chat.findOne({ conversation_id: newConversationId });
            
            if (chat) {
                // Add new messages to existing conversation
                chat.messages.push(
                    { role: 'user', content: message },
                    { role: 'assistant', content: responseContent }
                );
                chat.context = context;
                await chat.save();
            } else {
                // Create new conversation
                await Chat.create({
                    conversation_id: newConversationId,
                    messages: [
                        { role: 'user', content: message },
                        { role: 'assistant', content: responseContent }
                    ],
                    context: context
                });
            }
        } catch (error) {
            console.error('Error saving chat to MongoDB:', error);
        }

        return {
            content: responseContent,
            conversation_id: newConversationId,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = CompanyChatbot; 