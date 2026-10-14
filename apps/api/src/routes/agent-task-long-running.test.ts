import { longRunningCreateFields } from './agent-task-long-running';
import { ValidationError } from '../utils/error-handler';

describe('longRunningCreateFields (생성 라우트 연결)', () => {
    it('longRunning 이 없으면 빈 필드', () => {
        expect(longRunningCreateFields(undefined, 'user', 't1')).toEqual({});
    });
    it('기능 게이트가 꺼져 있으면(기본) ValidationError(400)', () => {
        expect(() => longRunningCreateFields({}, 'user', 't1')).toThrow(ValidationError);
    });
});
