import { UserRepository } from '../data/repositories/user-repository';
import { Pool } from 'pg';

describe('UserRepository', () => {
    let userRepository: UserRepository;
    let mockPool: jest.Mocked<Pool>;

    beforeEach(() => {
        mockPool = {
            query: jest.fn(),
        } as any;
        userRepository = new UserRepository(mockPool);
    });

    describe('createUser', () => {
        it('should insert a new user', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await userRepository.createUser('user-1', 'testuser', 'hashed-pass', 'test@example.com', 'admin');

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO users'),
                ['user-1', 'testuser', 'hashed-pass', 'test@example.com', 'admin']
            );
        });

        it('should use default role if not provided', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await userRepository.createUser('user-2', 'normaluser', 'hashed-pass', 'normal@example.com');

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.anything(),
                ['user-2', 'normaluser', 'hashed-pass', 'normal@example.com', 'user']
            );
        });
    });

    describe('getUserByUsername', () => {
        it('should return a user by username', async () => {
            const mockUser = { id: 'user-1', username: 'testuser' };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockUser] });

            const user = await userRepository.getUserByUsername('testuser');

            expect(user).toEqual(mockUser);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM users WHERE username = $1'),
                ['testuser']
            );
        });

        it('should return undefined if user not found', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const user = await userRepository.getUserByUsername('unknown');

            expect(user).toBeUndefined();
        });
    });

    describe('getUserById', () => {
        it('should return a user by id', async () => {
            const mockUser = { id: 'user-1', username: 'testuser' };
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockUser] });

            const user = await userRepository.getUserById('user-1');

            expect(user).toEqual(mockUser);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM users WHERE id = $1'),
                ['user-1']
            );
        });
    });

    describe('updateLastLogin', () => {
        it('should update last_login timestamp', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

            await userRepository.updateLastLogin('user-1');

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE users SET last_login = NOW() WHERE id = $1'),
                ['user-1']
            );
        });
    });

    describe('getAllUsers', () => {
        it('should return a list of users', async () => {
            const mockUsers = [{ id: 'u1' }, { id: 'u2' }];
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: mockUsers });

            const users = await userRepository.getAllUsers(10);

            expect(users).toEqual(mockUsers);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM users ORDER BY created_at DESC LIMIT $1'),
                [10]
            );
        });
    });
});
