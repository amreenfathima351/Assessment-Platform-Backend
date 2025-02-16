const WebSocket = require("ws");

const server = new WebSocket.Server({ port: 8080 });

server.on("connection", (ws) => {
  console.log("Client connected");

  // Send 1 MB of data in chunks over 10 seconds
  const totalBytes = 1 * 1024 * 1024; // 1 MB
  const chunkSize = 1024; // 1 KB
  let sentBytes = 0;

  const sendData = () => {
    if (sentBytes < totalBytes) {
      const data = Buffer.alloc(chunkSize, "a"); // Create a buffer of 1 KB filled with "a"
      ws.send(data);
      sentBytes += chunkSize;
      setTimeout(sendData, 10); // Send every 10ms
    } else {
      ws.close(); // Close the connection after sending data
    }
  };

  sendData();

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

console.log("WebSocket server is running on ws://localhost:8080");
