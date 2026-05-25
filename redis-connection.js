import {Redis} from 'ioredis'

function createNewRedisConnection(){
    return new Redis({
        host:'localhost',
        port:6379
    })
}

export const redis = createNewRedisConnection();
export const publisher = createNewRedisConnection();
export const subscriber = createNewRedisConnection();
