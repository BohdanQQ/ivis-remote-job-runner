// to enable db seeding and switch to different database file
process.env.NODE_ENV = 'test';

const {
  describe, it, before, after,
} = require('mocha');
const assert = require('assert');
const knex = require('../src/lib/knex');

const cacheModel = require('../src/models/task-build-cache');

describe('build cache tests', () => {
  before(async () => {
    await knex.migrate.rollback();
    await knex.migrate.latest();
    await knex.seed.run();
  }, 10000);

  after(() => {
    knex.destroy();
  });

  describe('isBuildCached()', () => {
    it('returns false when asked for nonexistent build', async () => {
      const nonexistentTaskId = -1;
      assert.equal(await cacheModel.isBuildCached(nonexistentTaskId, '', '', ''), false);
    });

    it('returns false when asked for existing build with different type', async () => {
      assert.equal(await cacheModel.isBuildCached(0, 'type1', 'subtype0', 'task0'), false);
    });

    it('returns false when asked for existing build with different subtype', async () => {
      assert.equal(await cacheModel.isBuildCached(0, 'type0', 'subtype1', 'task0'), false);
    });

    it('returns false when asked for existing build with different code', async () => {
      assert.equal(await cacheModel.isBuildCached(0, 'type0', 'subtype0', 'task1'), false);
    });

    it('returns true when asked for an existing cached build', async () => {
      assert.equal(await cacheModel.isBuildCached(0, 'type0', 'subtype0', 'task0'), true);
    });
  });

  describe('updateBuildCache() and isBuildCached() integration', () => {
    it('isBuildCached returns true when asked for an updated cached build', async () => {
      const args = [0, 'type0', 'subtype0', 'totallynewcode'];
      await cacheModel.updateBuildCache(...args);
      assert.equal(await cacheModel.isBuildCached(...args), true);
    });

    it('isBuildCached returns false when asked for an old cached build after an update', async () => {
      await cacheModel.updateBuildCache(0, 'type0', 'subtype0', 'totallynewcode');
      assert.equal(await cacheModel.isBuildCached(0, 'type0', 'subtype0', 'task0'), false);
    });

    it('isBuildCached returns true when asked for a newly cached entry (previously unseen)', async () => {
      const args = [111, '111', '111', 'code111'];
      await cacheModel.updateBuildCache(...args);
      assert.equal(await cacheModel.isBuildCached(...args), true);
    });
  });
  describe('invalidateBuildCache()', () => {
    it('invalidates when cache entry not present', async () => {
      const taskId = 0;
      await cacheModel.invalidateBuildCache(taskId);
      assert.equal(await cacheModel.isBuildCached(taskId, 's', 't', 'u'), false);
    });

    it('does not change invalid entries', async () => {
      const taskId = 0;
      await cacheModel.invalidateBuildCache(taskId);
      await cacheModel.invalidateBuildCache(taskId);
      assert.equal(await cacheModel.isBuildCached(taskId, 's', 't', 'u'), false);
    });

    it('invalidates when there is a valid cache entry', async () => {
      const taskId = 0;
      const args = [taskId, '111', '111', 'code111'];
      await cacheModel.updateBuildCache(...args);
      await cacheModel.invalidateBuildCache(taskId);
      assert.equal(await cacheModel.isBuildCached(...args), false);
    });
  });
});
