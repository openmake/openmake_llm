/**
 * Error Handler Tests
 */
import { AppError, ValidationError, AuthenticationError, AuthorizationError, NotFoundError, RateLimitError, DatabaseError, errorHandler, asyncHandler, notFoundHandler } from '../utils/error-handler';
import { Request, Response, NextFunction } from 'express';

// Mock logger
jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    })
}));

describe('Error Handler', () => {
    // Test all error classes
    describe('AppError classes', () => {
        it('should create AppError with correct properties', () => {
            const error = new AppError('Test error', 500, true, 'TEST_ERROR');
            expect(error.message).toBe('Test error');
            expect(error.statusCode).toBe(500);
            expect(error.isOperational).toBe(true);
            expect(error.code).toBe('TEST_ERROR');
        });

        it('should create ValidationError with 400 status', () => {
            const error = new ValidationError('Invalid input');
            expect(error.message).toBe('Invalid input');
            expect(error.statusCode).toBe(400);
            expect(error.code).toBe('VALIDATION_ERROR');
            expect(error.isOperational).toBe(true);
        });

        it('should create AuthenticationError with 401 status', () => {
            const error = new AuthenticationError('Not authenticated');
            expect(error.message).toBe('Not authenticated');
            expect(error.statusCode).toBe(401);
            expect(error.code).toBe('AUTHENTICATION_ERROR');
            expect(error.isOperational).toBe(true);
        });

        it('should create AuthenticationError with default message', () => {
            const error = new AuthenticationError();
            expect(error.message).toBe('인증이 필요합니다');
            expect(error.statusCode).toBe(401);
        });

        it('should create AuthorizationError with 403 status', () => {
            const error = new AuthorizationError('Access denied');
            expect(error.message).toBe('Access denied');
            expect(error.statusCode).toBe(403);
            expect(error.code).toBe('AUTHORIZATION_ERROR');
            expect(error.isOperational).toBe(true);
        });

        it('should create AuthorizationError with default message', () => {
            const error = new AuthorizationError();
            expect(error.message).toBe('권한이 없습니다');
            expect(error.statusCode).toBe(403);
        });

        it('should create NotFoundError with 404 status', () => {
            const error = new NotFoundError('Resource not found');
            expect(error.message).toBe('Resource not found');
            expect(error.statusCode).toBe(404);
            expect(error.code).toBe('NOT_FOUND');
            expect(error.isOperational).toBe(true);
        });

        it('should create NotFoundError with default message', () => {
            const error = new NotFoundError();
            expect(error.message).toBe('리소스를 찾을 수 없습니다');
            expect(error.statusCode).toBe(404);
        });

        it('should create RateLimitError with 429 status', () => {
            const error = new RateLimitError('Too many requests');
            expect(error.message).toBe('Too many requests');
            expect(error.statusCode).toBe(429);
            expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
            expect(error.isOperational).toBe(true);
        });

        it('should create RateLimitError with default message', () => {
            const error = new RateLimitError();
            expect(error.message).toBe('요청 제한을 초과했습니다');
            expect(error.statusCode).toBe(429);
        });

        it('should create DatabaseError with 500 status', () => {
            const error = new DatabaseError('Database connection failed');
            expect(error.message).toBe('Database connection failed');
            expect(error.statusCode).toBe(500);
            expect(error.code).toBe('DATABASE_ERROR');
            expect(error.isOperational).toBe(true);
        });

        it('should create DatabaseError with default message', () => {
            const error = new DatabaseError();
            expect(error.message).toBe('데이터베이스 오류가 발생했습니다');
            expect(error.statusCode).toBe(500);
        });
    });

    describe('errorHandler middleware', () => {
        let mockReq: Partial<Request>;
        let mockRes: Partial<Response>;
        let mockNext: NextFunction;

        beforeEach(() => {
            mockReq = {
                method: 'GET',
                path: '/test',
                body: {},
                query: {}
            };
            mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            mockNext = jest.fn();
        });

        it('should handle AppError and return correct status', () => {
            const error = new ValidationError('Invalid data');
            errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalled();
            const response = (mockRes.json as jest.Mock).mock.calls[0][0];
            expect(response.success).toBe(false);
            expect(response.error).toEqual({ code: 'VALIDATION_ERROR', message: 'Invalid data' });
        });

        it('should handle unknown errors as 500', () => {
            const error = new Error('Unknown error');
            errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalled();
            const response = (mockRes.json as jest.Mock).mock.calls[0][0];
            expect(response.success).toBe(false);
            expect(response.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Unknown error' });
        });

        it('should include stack in dev environment', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            const error = new AppError('Dev error', 500);
            errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

            const response = (mockRes.json as jest.Mock).mock.calls[0][0];
            expect(response.stack).toBeDefined();

            process.env.NODE_ENV = originalEnv;
        });

        it('should not include stack in production environment', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            const error = new AppError('Prod error', 500);
            errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

            const response = (mockRes.json as jest.Mock).mock.calls[0][0];
            expect(response.stack).toBeUndefined();

            process.env.NODE_ENV = originalEnv;
        });

        it('should include timestamp in response', () => {
            const error = new AppError('Test error', 500);
            errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

            const response = (mockRes.json as jest.Mock).mock.calls[0][0];
            expect(response.meta).toBeDefined();
            expect(response.meta.timestamp).toBeDefined();
            expect(typeof response.meta.timestamp).toBe('string');
        });
    });

    describe('asyncHandler', () => {
        let mockReq: Partial<Request>;
        let mockRes: Partial<Response>;
        let mockNext: NextFunction;

        beforeEach(() => {
            mockReq = {};
            mockRes = {};
            mockNext = jest.fn();
        });

        it('should pass resolved promise to next handler', async () => {
            const handler = asyncHandler(async (req, res, next) => {
                res.json = jest.fn().mockReturnValue({ success: true });
                return { success: true };
            });

            handler(mockReq as Request, mockRes as Response, mockNext);

            // Give async handler time to resolve
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should catch rejected promise and call next', async () => {
            const testError = new Error('Async error');
            const handler = asyncHandler(async (req, res, next) => {
                throw testError;
            });

            handler(mockReq as Request, mockRes as Response, mockNext);

            // Give async handler time to reject
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mockNext).toHaveBeenCalledWith(testError);
        });

        it('should handle synchronous errors in async function', async () => {
            const testError = new ValidationError('Sync error in async');
            const handler = asyncHandler(async (req, res, next) => {
                throw testError;
            });

            handler(mockReq as Request, mockRes as Response, mockNext);

            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mockNext).toHaveBeenCalledWith(testError);
        });
    });

    describe('notFoundHandler', () => {
        let mockReq: Partial<Request>;
        let mockRes: Partial<Response>;
        let mockNext: NextFunction;

        beforeEach(() => {
            mockReq = {
                method: 'POST',
                path: '/api/nonexistent'
            };
            mockRes = {};
            mockNext = jest.fn();
        });

        it('should create NotFoundError with route info', () => {
            notFoundHandler(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalled();
            const error = (mockNext as jest.Mock).mock.calls[0][0];
            expect(error).toBeInstanceOf(NotFoundError);
            expect(error.message).toContain('POST');
            expect(error.message).toContain('/api/nonexistent');
        });

        it('should pass error to next middleware', () => {
            notFoundHandler(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalledTimes(1);
            const error = (mockNext as jest.Mock).mock.calls[0][0];
            expect(error).toBeInstanceOf(NotFoundError);
        });
    });
});
