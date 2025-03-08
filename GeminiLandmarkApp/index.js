require("dotenv").config({ path: require('path').resolve(__dirname, '../.env') });
const { app, BrowserWindow, ipcMain, systemPreferences } = require("electron");
const axios = require("axios");
const path = require("path");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const GEMINI_IMAGE_API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

let mainWindow;

// Request microphone permission at app startup
async function requestMicrophonePermission() {
    try {
        const status = await systemPreferences.getMediaAccessStatus('microphone');
        if (status !== 'granted') {
            await systemPreferences.requestMediaAccess('microphone');
        }
        return status === 'granted';
    } catch (error) {
        console.error("Error requesting microphone permission:", error);
        return false;
    }
}

app.whenReady().then(async () => {
    // Request microphone permission
    await requestMicrophonePermission();

    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false,
            webSecurity: true,
            allowRunningInsecureContent: true,
            permissions: {
                microphone: true,
                media: true
            }
        }
    });

    mainWindow.loadFile(path.join(__dirname, "index.html"));

    // Handle voice recognition events
    ipcMain.handle('start-voice-recognition', async () => {
        try {
            const hasPermission = await requestMicrophonePermission();
            if (!hasPermission) {
                throw new Error('Microphone permission denied');
            }
            return true;
        } catch (error) {
            console.error('Error starting voice recognition:', error);
            return false;
        }
    });

    ipcMain.handle('stop-voice-recognition', () => {
        return true;
    });

    app.on("activate", async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await requestMicrophonePermission();
            mainWindow = new BrowserWindow({
                width: 800,
                height: 600,
                webPreferences: {
                    preload: path.join(__dirname, "preload.js"),
                    contextIsolation: true,
                    enableRemoteModule: false,
                    nodeIntegration: false,
                    webSecurity: true,
                    allowRunningInsecureContent: true,
                    permissions: {
                        microphone: true,
                        media: true
                    }
                }
            });
            mainWindow.loadFile(path.join(__dirname, "index.html"));
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

// Text Query Handling
ipcMain.handle("send-text", async (_, text) => {
    try {
        console.log("Sending text query:", text);
        const response = await axios.post(GEMINI_TEXT_API_URL, {
            contents: [{ role: "user", parts: [{ text }] }]
        });

        console.log("API Response:", JSON.stringify(response.data, null, 2));
        return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from AI.";
    } catch (error) {
        console.error("API Error:", error.response?.data || error.message);
        return `Error: ${error.response?.data?.error?.message || error.message}`;
    }
});

// Handle microphone permission request
ipcMain.handle("request-microphone-permission", async () => {
    try {
        const status = await systemPreferences.getMediaAccessStatus('microphone');
        return status === 'granted';
    } catch (error) {
        console.error("Error requesting microphone permission:", error);
        return false;
    }
});

// Wikipedia Fetch & Gemini Processing
ipcMain.handle("fetch-wikipedia", async (_, landmarkName) => {
    try {
        console.log(`Fetching Wikipedia data for: ${landmarkName}`);
        const wikiData = await fetchWikipediaData(landmarkName);

        console.log("Sending Wikipedia data to Gemini for reformatting...");
        const refinedResponse = await refineWithGemini(landmarkName, wikiData);

        console.log("Fetching travel recommendations...");
        const travelTips = await getTravelRecommendations(landmarkName);

        return `${refinedResponse}\n\n##🔹 **Travel Recommendations:**\n${travelTips}`;
    } catch (error) {
        console.error("Error fetching Wikipedia:", error.message);
        return "Error retrieving or processing Wikipedia information.";
    }
});

// Image Processing & Landmark Recognition
ipcMain.handle("send-image", async (_, imageData) => {
    try {
        console.log("Received Image Data:", imageData.slice(0, 50));
        const base64Image = imageData.split(",")[1];
        const mimeTypeMatch = imageData.match(/data:(.*?);base64/);

        if (!mimeTypeMatch) {
            console.error("Invalid image format!");
            return "Invalid image format. Please upload a valid image.";
        }

        const mimeType = mimeTypeMatch[1];
        console.log("Extracted MIME Type:", mimeType);

        const requestData = {
            contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64Image } }] }]
        };

        console.log("Sending Image Data to Gemini...");
        const response = await axios.post(GEMINI_IMAGE_API_URL, requestData);

        console.log("Gemini API Response:", JSON.stringify(response.data, null, 2));

        let aiResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from AI.";
        console.log("Gemini Identified:", aiResponse);

        const possibleLandmarkMatch = aiResponse.match(/(?:the|a|an) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/);
        const landmarkName = possibleLandmarkMatch ? possibleLandmarkMatch[1] : aiResponse.split("\n")[0].trim();

        if (!landmarkName) {
            return "❌ No recognizable landmark detected.";
        }

        console.log(`Fetching Wikipedia data for: ${landmarkName}`);
        const wikiData = await fetchWikipediaData(landmarkName);
        
        console.log("Sending Wikipedia data to Gemini for reformatting...");
        const refinedResponse = await refineWithGemini(landmarkName, wikiData);

        console.log("Fetching travel recommendations...");
        const travelTips = await getTravelRecommendations(landmarkName);

        return `${refinedResponse}\n\n##🔹 **Travel Recommendations:**\n${travelTips}`;

    } catch (error) {
        console.error("Error processing image:", error.message);
        return `Error processing image: ${error.message}`;
    }
});

// Helper Functions
const fetchWikipediaData = async (landmarkName) => {
    try {
        const wikiApiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(landmarkName)}`;
        const response = await axios.get(wikiApiUrl);
        return response.data.extract || "Wikipedia has no details on this topic.";
    } catch (error) {
        console.error("Wikipedia API Error:", error.message);
        return "Error retrieving Wikipedia information.";
    }
};

const refineWithGemini = async (landmarkName, wikiData) => {
    try {
        const prompt = `
Rewrite the following information about "${landmarkName}" in a *well-structured Markdown format*.  

*Formatting Guidelines:*  
- Use *headings (##, ###) where appropriate*.  
- Maintain *line breaks* and *paragraph spacing*.  
- dont use bold 
- Ensure *proper indentation* for readability.  

Here is the raw information:  
\`
${wikiData}
\`

*Now, format and refine the content in Markdown as per the guidelines.*  
`;

        const requestData = {
            contents: [{ role: "user", parts: [{ text: prompt }] }]
        };

        const response = await axios.post(GEMINI_TEXT_API_URL, requestData);
        return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No refined information available.";
    } catch (error) {
        console.error("Gemini Refinement Error:", error.message);
        return "Error refining Wikipedia data.";
    }
};

const getTravelRecommendations = async (landmarkName) => {
    try {
        const prompt = `You are a travel expert. Please provide detailed travel recommendations for ${landmarkName}. Include the following sections:

1. Best Time to Visit
2. How to Get There
3. What to See and Do
4. Local Tips and Advice
5. Weather in the Area
6. Best Restaurants and Cafes
7. Best Hotels and Accommodations
8. Best Activities and Attractions
9. Best Shopping and Markets
10. Best Nightlife and Entertainment
11. Best Day Trips and Excursions
12. Best Local Transportation and Getting Around
13. Packing List and Essentials

For each section, provide at least 3-4 bullet points with detailed and specific recommendations. Include practical tips, insider advice, and any important considerations. Format the response with clear headings and bullet points. If any section is not applicable, please explain why.`;

        const requestData = {
            contents: [{ role: "user", parts: [{ text: prompt }] }]
        };

        const response = await axios.post(GEMINI_TEXT_API_URL, requestData);
        return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No travel recommendations available.";
    } catch (error) {
        console.error("Travel Recommendations Error:", error.message);
        return "Error generating travel recommendations.";
    }
};

const generateHolidayPlan = async (destination, days) => {
    try {
        const prompt = `Create a detailed ${days}-day travel itinerary for ${destination}. For each day, include:

1. Morning activities (including breakfast recommendations)
2. Afternoon activities (including lunch recommendations)
3. Evening activities (including dinner recommendations)
4. Estimated timings for each activity
5. Transportation tips between locations
6. Estimated costs (in local currency and USD)
7. Local customs and etiquette tips
8. Weather-appropriate clothing suggestions
9. Photo opportunity spots
10. Alternative indoor options in case of bad weather

Format the response day by day, with clear headings and bullet points. Make the itinerary realistic and well-paced, considering travel times between locations. Include local specialties and hidden gems, not just tourist spots.`;

        const requestData = {
            contents: [{
                parts: [{
                    text: prompt
                }]
            }]
        };

        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + GEMINI_API_KEY, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });

        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error('Error generating holiday plan:', error);
        throw error;
    }
};

// Handle holiday plan generation
ipcMain.handle('generate-holiday-plan', async (_, destination, days) => {
    try {
        const prompt = `Create a detailed ${days}-day travel itinerary for ${destination}. Use HTML tags for formatting and structure the response as follows:

${destination} ${days}-Day Itinerary

Essential Information

• <b>Weather and Best Time:</b> [Details]
• <b>Local Currency and Costs:</b> [Details]
• <b>Local Customs & Etiquette:</b> [Details]
• <b>What to Pack:</b> [Details]

<br>

Daily Itineraries

<br>

Day 1: [Theme/Area Focus]

<b>Morning (Time: 9:00 AM - 12:00 PM)</b>
• <b>Activities:</b> [List with timings]
• <b>Breakfast recommendation:</b> [Details]
• <b>Transportation details:</b> [Details]
• <b>Photo opportunities:</b> [Details]
• <b>Estimated costs:</b> [Details in local currency and USD]

<b>Afternoon (Time: 12:00 PM - 5:00 PM)</b>
• <b>Activities:</b> [List with timings]
• <b>Lunch recommendation:</b> [Details]
• <b>Transportation details:</b> [Details]
• <b>Photo opportunities:</b> [Details]
• <b>Estimated costs:</b> [Details in local currency and USD]

<b>Evening (Time: 5:00 PM - 9:00 PM)</b>
• <b>Activities:</b> [List with timings]
• <b>Dinner recommendation:</b> [Details]
• <b>Transportation details:</b> [Details]
• <b>Photo opportunities:</b> [Details]
• <b>Estimated costs:</b> [Details in local currency and USD]

<br><br>

Day 2: [Theme/Area Focus]

[Same structure as Day 1]

<br><br>

Day 3: [Theme/Area Focus]

[Same structure as Day 1]

<br><br>

Additional Information

• <b>Rainy Day Alternatives:</b> [Details]
• <b>Emergency Contacts:</b> [Details]
• <b>Local Transportation Tips:</b> [Details]
• <b>Money-Saving Tips:</b> [Details]

Format the response with proper HTML bold tags (<b>text</b>), clear bullet points, and double line breaks (<br><br>) between days for better readability. Include specific details like restaurant names, costs, and timing. Make the itinerary realistic and well-paced.`;

        const response = await axios.post(GEMINI_TEXT_API_URL, {
            contents: [{
                parts: [{
                    text: prompt
                }]
            }]
        });

        return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No itinerary generated.";
    } catch (error) {
        console.error('Error generating holiday plan:', error);
        throw new Error('Failed to generate holiday plan. Please try again.');
    }
});

// Landmark Recognition Function
async function recognizeLandmark(imageData) {
    try {
        const base64Image = imageData.split(",")[1];
        const mimeTypeMatch = imageData.match(/data:(.*?);base64/);

        if (!mimeTypeMatch) {
            throw new Error("Invalid image format");
        }

        const mimeType = mimeTypeMatch[1];
        const requestData = {
            contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64Image } }] }]
        };

        const response = await axios.post(GEMINI_IMAGE_API_URL, requestData);
        const aiResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from AI.";
        
        // Extract landmark name from AI response
        const possibleLandmarkMatch = aiResponse.match(/(?:the|a|an) ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/);
        const landmarkName = possibleLandmarkMatch ? possibleLandmarkMatch[1] : aiResponse.split("\n")[0].trim();

        if (!landmarkName) {
            throw new Error("No recognizable landmark detected");
        }

        return {
            landmarkName,
            description: aiResponse
        };
    } catch (error) {
        console.error("Error in recognizeLandmark:", error);
        throw error;
    }
}

// Export the functions
module.exports = {
    recognizeLandmark,
    getTravelRecommendations,
    generateHolidayPlan
};
