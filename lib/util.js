function isInteger(value) {
  const parsed = parseInt(value, 10);
  return !Number.isNaN(parsed);
}

function ensureParam(pkey, request, predicate) {
  if (!request.params[pkey]) {
    return false;
  }

  return predicate(request.params[pkey]);
}

/**
 * Walks through an object and chekcs whether it conforms (as a subset) to a
 * supplied description
 * @param {Object} obj
 * @param {Object} description - an object whose key-value pairs correspond to
 * key-typeof(obj[key]) pairs in the matched object
 * @returns whether obj conforms to description or null if description is invalid
 * @note the function uses quick condition evaluation, meaning that
 * false may be returned earlier than null (because the evalutation found invalid
 * type/missing property first)
 */
function walkObject(obj, description) {
  const validDescription = Object.keys(description)
    .every((key) => description[key] instanceof Object
                  || ['int', 'str', 'ignore'].indexOf(description[key]) !== -1);
  if (!validDescription) {
    return null;
  }

  return Object.keys(description).reduce((acc, key) => {
    if (acc == null) {
      return null;
    }
    if (!acc) {
      return false;
    }
    const valueType = description[key];
    if (valueType === 'ignore') {
      return Object.hasOwnProperty.call(obj, key);
    }

    if (valueType === 'int') {
      if (!isInteger(obj[key])) {
        return false;
      }
    } else if (valueType === 'str') {
      if (typeof (obj[key]) !== 'string') {
        return false;
      }
    } else {
      if (typeof (obj[key]) !== 'object') {
        return false;
      }
      return walkObject(obj[key], valueType);
    }
    return true;
  }, true);
}

module.exports = { walkObject, ensureParam };
