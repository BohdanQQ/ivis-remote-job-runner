const assert = require('assert');
const { describe, it } = require('mocha');
const { walkObject } = require('../lib/util');

describe('Utility', () => {
  describe('#walkObject()', () => {
    it('returns null when the description is invalid in the first layer', () => {
      const desc = {
        invalid: '',
      };
      assert.equal(walkObject({}, desc), null);
    });

    it('returns null when the description is invalid in a nested layer', () => {
      const desc = {
        validStr: 'str',
        validIgnore: 'ingore',
        invalidObj: {
          invalid: false,
        },
      };

      assert.equal(walkObject({ validStr: '', validIgnore: undefined, invalidObj: {} }, desc), null);
    });

    it('returns false when the description is invalid in a nested layer but a missing property is detected earlier', () => {
      const desc = {
        validStr: 'str',
        invalid: {
          invalid: false,
        },
      };
      assert.equal(walkObject({}, desc), false);
    });

    it('returns false when the description is invalid in a nested layer but a property is of wrong type earlier', () => {
      const desc = {
        validStr: 'str',
        invalid: {
          invalid: false,
        },
      };
      assert.equal(walkObject({ validStr: 20 }, desc), false);
    });

    it('returns false when a property is of wrong type (string)', () => {
      const desc = {
        validStr: 'str',
        obj: {
          validStr: '11',
        },
      };
      assert.equal(walkObject({ validStr: 20 }, desc), false);
    });

    it('returns false when a property is of wrong type (int)', () => {
      const desc = {
        validStr: 'int',
        obj: {
          validStr: '11',
        },
      };
      assert.equal(walkObject({ validStr: 20.0 }, desc), false);
    });

    it('returns false when a property is of wrong type (obj)', () => {
      const desc = {
        validStr: {},
        obj: {
          validStr: '11',
        },
      };
      assert.equal(walkObject({ validStr: { alpha: null } }, desc), false);
    });

    it('returns true when a property is of correct type (string)', () => {
      const desc = {
        validStr: 'str',
      };
      assert.equal(walkObject({ validStr: 'omega' }, desc), true);
    });

    it('returns true when a property is of correct type (int)', () => {
      const desc = {
        validStr: 'int',
      };
      assert.equal(walkObject({ validStr: 20 }, desc), true);
    });

    it('returns true when a property is of correct type (obj)', () => {
      const desc = {
        validStr: {},
      };
      assert.equal(walkObject({ validStr: { alpha: null } }, desc), true);
    });

    it('supports complex nesting: accepts correct', () => {
      const desc = {
        validObj: {
          validObj: {
            two: 'int',
          },
          string: 'str',
          ignored: 'ignore',
        },
      };
      const val = {
        validObj: {
          validObj: {
            two: 2,
          },
          string: 'strain',
          ignored: undefined,
        },
      };
      assert.equal(walkObject(val, desc), true);
    });

    it('supports complex nesting: rejects incorrect (type)', () => {
      const desc = {
        validObj: {
          validObj: {
            two: 'int',
          },
          string: 'str',
          ignored: 'ignore',
        },
      };
      const val = {
        validObj: {
          validObj: {
            two: 'eleven',
          },
          string: 'strain',
          ignored: undefined,
        },
      };
      assert.equal(walkObject(val, desc), false);
    });

    it('supports complex nesting: rejects incorrect (missing property)', () => {
      const desc = {
        validObj: {
          validObj: {
            two: 'int',
          },
          string: 'str',
          ignored: 'ignore',
        },
      };
      const val = {
        validObj: {
          validObj: {
            two: 2,
          },
          ignored: undefined,
        },
      };
      assert.equal(walkObject(val, desc), false);
    });

    it('enforces presence of ignored properties (missing rejected)', () => {
      const desc = {
        mandatory: 'ignore',
      };

      assert.equal(walkObject({ other: 'x' }, desc), false);
    });
  });
});
