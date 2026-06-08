const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// In-memory database to hold active games
let activeGames = {}; 

// Sample STEM Questions (With LaTeX syntax for math math rendering later!)
const stemQuestions = [
    { q: "Solve for x: $2x + 5 = 15$", options: ["x = 5", "x = 10", "x = 7", "x = 3"], correct: 0 },
    { q: "Which programming language uses indentation to define code blocks?", options: ["Java", "Python", "C++", "JavaScript"], correct: 1 },
    { q: "What is the molecular formula for Glucose?", options: ["H2O", "CO2", "C6H12O6", "NaCl"], correct: 2 }
];

io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    // 1. Host creates a game
    socket.on('create-game', () => {
        let pin = Math.floor(100000 + Math.random() * 900000).toString(); // Generate 6-digit PIN
        activeGames[pin] = {
            hostId: socket.id,
            players: [],
            currentQuestionIndex: 0
        };
        socket.join(pin);
        socket.emit('game-created', pin);
    });

    // 2. Player tries to join with a PIN
    socket.on('join-game', ({ pin, nickname }) => {
        if (activeGames[pin]) {
            let playerIndex = activeGames[pin].players.push({
                id: socket.id,
                nickname: nickname,
                score: 0
            }) - 1;
            
            socket.join(pin);
            socket.emit('join-success');
            
            // Notify the host that a player joined
            io.to(activeGames[pin].hostId).emit('update-player-list', activeGames[pin].players);
        } else {
            socket.emit('join-failure', 'Game PIN not found!');
        }
    });

    // 3. Host starts the game / moves to next question
    socket.on('next-question', (pin) => {
        let game = activeGames[pin];
        if (game && game.currentQuestionIndex < stemQuestions.length) {
            let questionData = stemQuestions[game.currentQuestionIndex];
            
            // Send full question details to Host
            io.to(game.hostId).emit('display-question-host', {
                q: questionData.q,
                options: questionData.options
            });

            // Send ONLY buttons config to players (just like Kahoot!)
            io.to(pin).emit('display-question-player', {
                totalOptions: questionData.options.length
            });
        } else {
            io.to(pin).emit('game-over', game.players.sort((a,b) => b.score - a.score));
        }
    });

    // 4. Player submits an answer
    socket.on('submit-answer', ({ pin, answerIndex }) => {
        let game = activeGames[pin];
        if (game) {
            let questionData = stemQuestions[game.currentQuestionIndex];
            let player = game.players.find(p => p.id === socket.id);
            
            if (player && parseInt(answerIndex) === questionData.correct) {
                player.score += 1000; // Flat points for prototype simplicity
            }
            
            // Tell host someone answered
            io.to(game.hostId).emit('player-answered', player ? player.nickname : "Someone");
        }
    });

    // 5. Host ends the current question timer
    socket.on('end-question', (pin) => {
        let game = activeGames[pin];
        if (game) {
            let questionData = stemQuestions[game.currentQuestionIndex];
            // Show scoreboard on host
            io.to(game.hostId).emit('show-results', {
                correctIndex: questionData.correct,
                leaderboard: game.players
            });
            // Prepare for next round
            game.currentQuestionIndex++;
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected: ' + socket.id);
    });
});

http.listen(3000, () => {
    console.log('STEM Quiz Server running on http://localhost:3000');
});