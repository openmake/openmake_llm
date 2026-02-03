/**
 * Cluster Manager Tests
 */

import { ClusterManager } from '../../../backend/api/src/cluster/manager';

describe('ClusterManager', () => {
    let manager: ClusterManager;

    beforeEach(() => {
        manager = new ClusterManager({
            name: 'test-cluster',
            nodes: [],
            heartbeatInterval: 10000
        });
    });

    afterEach(() => {
        manager.stop();
    });

    describe('constructor', () => {
        it('should create a cluster manager with unique id', () => {
            expect(manager.id).toBeDefined();
            expect(typeof manager.id).toBe('string');
        });

        it('should have empty nodes by default', () => {
            expect(manager.getNodes()).toEqual([]);
        });
    });

    describe('getStats', () => {
        it('should return correct initial stats', () => {
            const stats = manager.getStats();

            expect(stats.totalNodes).toBe(0);
            expect(stats.onlineNodes).toBe(0);
            expect(stats.totalModels).toBe(0);
            expect(stats.uniqueModels).toEqual([]);
        });
    });

    describe('getOnlineNodes', () => {
        it('should return empty array when no nodes', () => {
            expect(manager.getOnlineNodes()).toEqual([]);
        });
    });

    describe('getBestNode', () => {
        it('should return undefined when no nodes available', () => {
            expect(manager.getBestNode()).toBeUndefined();
        });

        it('should return undefined when no nodes with specified model', () => {
            expect(manager.getBestNode('non-existent-model')).toBeUndefined();
        });
    });
});
