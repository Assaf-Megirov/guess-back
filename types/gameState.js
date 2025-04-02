const GameState = Object.freeze({
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    ABANDONED: 'abandoned'
});

module.exports = GameState;