const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'api',
    {
        sendText: (text) => ipcRenderer.invoke('send-text', text),
        sendImage: (imageData) => ipcRenderer.invoke('send-image', imageData),
        fetchWikipedia: (landmarkName) => ipcRenderer.invoke('fetch-wikipedia', landmarkName),
        requestMicrophonePermission: () => ipcRenderer.invoke('request-microphone-permission'),
        generateHolidayPlan: (destination, days) => ipcRenderer.invoke('generate-holiday-plan', destination, days),
        onVoiceResult: (callback) => {
            ipcRenderer.on('voice-result', (_, text) => callback(text));
        },
        startVoiceRecognition: () => ipcRenderer.invoke('start-voice-recognition'),
        stopVoiceRecognition: () => ipcRenderer.invoke('stop-voice-recognition'),
        getCategoryInfo: (landmarkName, categoryNumber) => ipcRenderer.invoke('get-category-info', landmarkName, categoryNumber)
    }
);

// Ensure DOM is fully loaded
window.addEventListener("DOMContentLoaded", () => {
    try {
        if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
            console.error("Speech Recognition API not supported.");
            return;
        }

        const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.lang = "en-US";
        recognition.continuous = false;
        recognition.interimResults = false;
        let isListening = false;

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            ipcRenderer.send("voice-result", transcript);
        };

        recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            isListening = false;
        };

        ipcRenderer.on("start-voice", async () => {
            try {
                // Request microphone permission before starting
                await window.api.requestMicrophonePermission();
                if (!isListening) {
                    isListening = true;
                    recognition.start();
                }
            } catch (error) {
                console.error("Error starting voice recognition:", error);
            }
        });

        recognition.onend = () => {
            isListening = false;
        };

    } catch (error) {
        console.error("Preload error:", error);
    }
});