const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// In-memory database to hold active games
let activeGames = {};

function generateUniquePin() {
    let pin;
    do {
        pin = Math.floor(100000 + Math.random() * 900000).toString();
    } while (activeGames[pin]);
    return pin;
}

// Sample STEM Questions (With LaTeX syntax for math rendering later)
const stemQuestions = [
    { q: "Solve for x: $2x + 5 = 15$", options: ["x = 5", "x = 10", "x = 7", "x = 3"], correct: 0 },
    { q: "Which programming language uses indentation to define code blocks?", options: ["Java", "Python", "C++", "JavaScript"], correct: 1 },
    { q: "What is the molecular formula for Glucose?", options: ["H2O", "CO2", "C6H12O6", "NaCl"], correct: 2 },
    { q: "What is the acceleration due to gravity on Earth ($g$)?", options: ["9.81 m/s²", "3.14 m/s²", "12.5 m/s²", "1.62 m/s²"], correct: 0 },
    { q: "In binary, what number does the byte `00001010` represent?", options: ["5", "10", "12", "8"], correct: 1 },
    { q: "What is the derivative of $f(x) = 3x^2 + 5x$ with respect to $x$?", options: ["$6x + 5$", "$3x + 5$", "$6x^2$", "$5x + 3$"], correct: 0 },
    { q: "Which data structure operates on a 'First In, First Out' (FIFO) basis?", options: ["Stack", "Array", "Queue", "Binary Tree"], correct: 2 },
    { q: "What subatomic particle carries a negative electric charge?", options: ["Proton", "Neutron", "Electron", "Quark"], correct: 2 },
    { q: "What does the following Python expression evaluate to: `11 // 3`?", options: ["3.666...", "3", "2", "4"], correct: 1 },
    { q: "What type of chemical bond involves the sharing of electron pairs between atoms?", options: ["Ionic bond", "Covalent bond", "Hydrogen bond", "Metallic bond"], correct: 1 },
    { q: "If a wave has a frequency of 10 Hz and a wavelength of 3 meters, what is its speed?", options: ["30 m/s", "3.33 m/s", "13 m/s", "0.33 m/s"], correct: 0 },
    { q: "Which of the following sorting algorithms has the best worst-case time complexity?", options: ["Bubble Sort", "Insertion Sort", "Merge Sort", "Selection Sort"], correct: 2 },
    { q: "What is the primary gas that makes up the majority of Earth's atmosphere?", options: ["Oxygen", "Carbon Dioxide", "Nitrogen", "Argon"], correct: 2 },
    { q: "Find the value of $\\log_2(64)$.", options: ["6", "8", "32", "12"], correct: 0 },
    { q: "What law of physics states that for every action, there is an equal and opposite reaction?", options: ["Newton's 1st Law", "Newton's 2nd Law", "Newton's 3rd Law", "Law of Gravitation"], correct: 2 }
];

io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    // 1. Host creates a game
    socket.on('create-game', () => {
        const pin = generateUniquePin();
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
        if (!pin || !nickname || nickname.trim().length === 0) {
            socket.emit('join-failure', 'Please enter a valid PIN and nickname.');
            return;
        }

        const game = activeGames[pin];
        if (!game) {
            socket.emit('join-failure', 'Game PIN not found.');
            return;
        }

        if (game.currentQuestionIndex >= stemQuestions.length) {
            socket.emit('join-failure', 'This game has already finished.');
            return;
        }

        game.players.push({
            id: socket.id,
            nickname: nickname.trim(),
            score: 0
        });

        socket.join(pin);
        socket.emit('join-success');
        io.to(game.hostId).emit('update-player-list', game.players);
    });

    // 3. Host starts the game / moves to next question
    socket.on('next-question', (pin) => {
        const game = activeGames[pin];
        if (game) {
            if (game.currentQuestionIndex < stemQuestions.length) {
                const questionData = stemQuestions[game.currentQuestionIndex];
                
                io.to(game.hostId).emit('display-question-host', {
                    q: questionData.q,
                    options: questionData.options,
                    index: game.currentQuestionIndex + 1,
                    total: stemQuestions.length
                });

                io.to(pin).emit('display-question-player', {
                    totalOptions: questionData.options.length
                });
            } else {
                const finalStandings = [...game.players].sort((a, b) => b.score - a.score);
                
                const podiumData = {
                    first: finalStandings[0] || { nickname: 'N/A', score: 0 },
                    second: finalStandings[1] || null,
                    third: finalStandings[2] || null
                };

                io.to(game.hostId).emit('game-over-podium', podiumData);
                io.to(pin).emit('game-over');
                delete activeGames[pin];
            }
        }
    });

    // 4. Player submits an answer
    socket.on('submit-answer', ({ pin, answerIndex }) => {
        let game = activeGames[pin];
        if (game) {
            let questionData = stemQuestions[game.currentQuestionIndex];
            let player = game.players.find(p => p.id === socket.id);
            
            if (player) {
                // Force both values to be Numbers to eliminate type mismatches
                let chosen = Number(answerIndex);
                let correct = Number(questionData.correct);

                console.log(`[DEBUG] Player ${player.nickname} chose: ${chosen}, Correct answer is: ${correct}`);

                if (chosen === correct) {
                    player.score += 1000;
                    console.log(`[DEBUG] Correct! ${player.nickname}'s new score: ${player.score}`);
                } else {
                    console.log(`[DEBUG] Incorrect answer chosen.`);
                }
            }
            
            // Tell host someone answered
            io.to(game.hostId).emit('player-answered', player ? player.nickname : "Someone");
        }
    });

    // 5. Host ends the current question timer
    socket.on('end-question', (pin) => {
        const game = activeGames[pin];
        if (!game) {
            return;
        }

        const questionData = stemQuestions[game.currentQuestionIndex];
        io.to(game.hostId).emit('show-results', {
            correctIndex: questionData.correct,
            leaderboard: [...game.players].sort((a, b) => b.score - a.score)
        });

        game.currentQuestionIndex += 1;
    });

    socket.on('disconnect', () => {
        console.log('User disconnected: ' + socket.id);

        for (const pin in activeGames) {
            const game = activeGames[pin];

            if (game.hostId === socket.id) {
                io.to(pin).emit('game-ended', 'Host disconnected.');
                delete activeGames[pin];
                break;
            }

            const playerIndex = game.players.findIndex((player) => player.id === socket.id);
            if (playerIndex !== -1) {
                game.players.splice(playerIndex, 1);
                io.to(game.hostId).emit('update-player-list', game.players);
                break;
            }
        }
    });
});

http.listen(3000, () => {
    console.log('STEM Quiz Server running on http://localhost:3000');
});