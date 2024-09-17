const axios = require('axios');

async function sendRequest(user_id) {
    try {
        const response = await axios.post('http://localhost:3000/api/v1/task', {
            user_id: user_id
        });
        console.log(`Response: ${response.data.message}`);
    } catch (error) {
        if (error.response) {
            console.log(`Error: ${error.response.data.message}`);
        } else {
            console.error('Request failed:', error.message);
        }
    }
}

async function runTest() {
    const user_id = "123";

    for (let i = 0; i < 10; i++) {
        console.log(i);
        await sendRequest(user_id);
        await new Promise(resolve => setTimeout(resolve, 400));
    }
}

runTest();