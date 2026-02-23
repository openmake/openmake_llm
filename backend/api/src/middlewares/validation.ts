/**
 * Zod Validation Middleware
 */
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, ZodIssue } from 'zod';
import { badRequest } from '../utils/api-response';

/**
 * Validation middleware factory
 * Returns 400 with formatted error messages on validation failure
 */
export function validate<T>(schema: ZodSchema<T>) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const validated = schema.parse(req.body);
            req.body = validated; // Replace with validated/transformed data
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const messages = error.issues.map((e: ZodIssue) => 
                    e.path.length > 0 ? `${e.path.join('.')}: ${e.message}` : e.message
                );
                return res.status(400).json(badRequest(messages.join('; ')));
            }
            next(error);
        }
    };
}

/**
 * Validate query parameters
 */
export function validateQuery<T extends object>(schema: ZodSchema<T>) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const validated = schema.parse(req.query);
            // Express v5 (router package): req.query is a read-only getter on IncomingMessage.
            // Object.defineProperty fails when the property is non-configurable.
            // Solution: mutate the query object in-place so the getter keeps working.
            const currentQuery = req.query as Record<string, unknown>;
            for (const key of Object.keys(currentQuery)) {
                delete currentQuery[key];
            }
            Object.assign(currentQuery, validated);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const messages = error.issues.map((e: ZodIssue) => 
                    e.path.length > 0 ? `${e.path.join('.')}: ${e.message}` : e.message
                );
                return res.status(400).json(badRequest(messages.join('; ')));
            }
            next(error);
        }
    };
}
