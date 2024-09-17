// const express = require('express');
// const rateLimit = require('express-rate-limit');
// const Queue = require('bull');
// const fs = require('fs');
// const redis = require('redis');

// const redisClient = redis.createClient();

// const taskQueue = new Queue('taskQueue', {
//     redis: {
//         host: '0.0.0.0',
//         port: 6379,
//     }
// });

// const app = express();
// app.use(express.json()); 

// const userTaskLimits = {};
// const rateLimitWindowMs = 60000;

// app.post('/api/v1/task', async (req, res) => {
//     const { user_id } = req.body;
//     if (!user_id) {
//         return res.status(400).json({ error: 'user_id is required' });
//     }
//     const currentTime = Date.now();
//     if (!userTaskLimits[user_id]) {
//         userTaskLimits[user_id] = {
//             count: 0,
//             lastRequestTime: currentTime,
//             tasksInQueue: 0,
//             lastResetTime: currentTime
//         };
//     }

//     const oneMinute = 60*1000;
//     if(currentTime - userTaskLimits[user_id].lastResetTime >= oneMinute) {
//         userTaskLimits[user_id].count = 0;
//         userTaskLimits[user_id].lastResetTime = currentTime;
//     }

//     const timeDifference = (currentTime - userTaskLimits[user_id].lastRequestTime) / 1000;

//     if (timeDifference < 1 && userTaskLimits[user_id].count >= 1) {
//         try {
//             await taskQueue.add({ user_id });
//         } catch (error) {
//             console.error('Error adding task to queue:', error);
//             return res.status(500).json({ message: 'Error queuing task' });
//         }        
//         userTaskLimits[user_id].tasksInQueue += 1;
//         return res.status(429).json({ message: 'Rate limit exceeded, task queued' });
//     }

//     await processTask(user_id);
//     userTaskLimits[user_id].lastRequestTime = Date.now();
//     userTaskLimits[user_id].count += 1;
//     if (userTaskLimits[user_id].count > 20) {
//         return res.status(429).json({ message: 'Task limit exceeded for the minute' });
//     }

//     res.status(200).json({ message: 'Task processed' });
// });

// taskQueue.process(async (job) => {
//     const { user_id } = job.data;
//     await processTask(user_id);
// });

// async function processTask(user_id) {
//     const logEntry = `${user_id}-task completed at-${new Date().toISOString()}\n`;
//     console.log(logEntry);

//     fs.appendFile('task-log.txt', logEntry, (err) => {
//         if (err) {
//             console.error('Error writing to log file:', err);
//         }
//     });
// }

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, '0.0.0.0', () => {
//     console.log(`Server running on port ${PORT}`);
// });

const express = require('express');
const Queue = require('bull');
const fs = require('fs');
const Redis = require('ioredis');

const redis = new Redis();

// Create Bull queue with Redis backend
const taskQueue = new Queue('taskQueue', {
    redis: {
        host: '127.0.0.1',
        port: 6379,
    }
});

const app = express();
app.use(express.json());  // Built-in JSON body parsing in express

// Rate limits
const RATE_LIMITS = {
    PER_SECOND: 1, // 1 task per second
    PER_MINUTE: 20 // 20 tasks per minute
};

const SECOND = 1000;
const MINUTE = 60 * 1000;

// This variable is to track the last task's execution time globally
let lastTaskExecutionTime = Date.now();

app.post('/api/v1/task', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
    }

    try {
        const currentTime = Date.now();

        // Redis keys for tracking user task limits
        const perMinuteKey = `user:${user_id}:minuteRateLimit`;
        const perSecondKey = `user:${user_id}:secondRateLimit`;

        // Fetch the current minute and second task counts from Redis
        const [minuteTaskCount, secondTaskCount] = await Promise.all([
            redis.get(perMinuteKey),
            redis.get(perSecondKey)
        ]);

        const minuteCount = minuteTaskCount ? parseInt(minuteTaskCount) : 0;
        const secondCount = secondTaskCount ? parseInt(secondTaskCount) : 0;

        // Enforce a delay of 1 second between task processing
        const timeSinceLastTask = currentTime - lastTaskExecutionTime;

        // console.log(lastTaskExecutionTime);

        // if (timeSinceLastTask < SECOND) {
        //     await new Promise(resolve => setTimeout(resolve, SECOND - timeSinceLastTask));
        // }

        // Update the last task execution time
        
        const delay = timeSinceLastTask < SECOND ? SECOND - timeSinceLastTask : 0;
        console.log(delay);
        lastTaskExecutionTime = Date.now();

        // Check if per-minute limit is exceeded
        if (minuteCount >= RATE_LIMITS.PER_MINUTE) {
            console.log('queue added minute');
            // Queue the task for later execution with delay after the minute
            await taskQueue.add({ user_id }, { delay: MINUTE }); // Delayed execution
            return res.status(429).json({ message: 'Rate limit per minute exceeded, task queued for later' });
        }

        // Check if per-second limit is exceeded
        if (secondCount >= RATE_LIMITS.PER_SECOND) {
            console.log('queue added seconds');
            // Queue the task for delayed execution (1-second delay)
            await taskQueue.add({ user_id }, { delay: SECOND*secondCount }); // Delay by 1 second
            return res.status(429).json({ message: 'Rate limit per second exceeded, task queued' });
        }

        // If within limits, process task immediately
        console.log('normal process');
        await processTask(user_id);

        // Update Redis rate limits
        await redis.multi()
            .incr(perSecondKey)                       // Increment per-second task count
            .expire(perSecondKey, 1)                  // Expire in 1 second
            .incr(perMinuteKey)                       // Increment per-minute task count
            .expire(perMinuteKey, 60)                 // Expire in 1 minute
            .exec();

        res.status(200).json({ message: 'Task processed' });

    } catch (error) {
        console.error('Error processing task:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Bull queue worker for processing queued tasks
taskQueue.process(async (job) => {
    const { user_id } = job.data;

    // Now process the task
    await processTask(user_id);
});

// Function to process the task and log it
async function processTask(user_id) {
    const logEntry = `${user_id}-task completed at-${new Date().toISOString()}\n`;
    console.log(logEntry);

    // Log task to a file
    fs.appendFile('task-log.txt', logEntry, (err) => {
        if (err) {
            console.error('Error writing to log file:', err);
        }
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});