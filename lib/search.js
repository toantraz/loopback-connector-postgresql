'use strict'

var SqlConnector = require('loopback-connector').SqlConnector;
var ParameterizedSQL = SqlConnector.ParameterizedSQL;
var debug = require('debug')('loopback:connector:postgresql');

module.exports = mixinSearch

function mixinSearch(PostgreSQL) {
    PostgreSQL.prototype.getJoinQuery = function(model, where) {
        var joinQuery = ''
        var whereQuery = []
        for (var key in where) {
            if (key.indexOf('__') >= 0) {
                // compose key
                var Model = this._models[model].model
                let [relation, field, operator] = key.split('__')
                
                let relationObj = Model.relations[relation]
                if (relationObj) {
                    let joinType
                    let fromTable = relationObj.modelFrom.name.toLowerCase()
                    let fromKey = relationObj.keyFrom
                    let toTable = relationObj.modelTo.name.toLowerCase()
                    let toKey = relationObj.keyTo;
                    switch (operator) {
                        case 'nexist':
                            joinType = 'LEFT JOIN'
                            whereQuery.push(`${toTable}.id IS NULL`)
                            break
                        default:
                            joinType = 'INNER JOIN'
                            break
                    }
                    joinQuery = `${joinQuery} ${joinType} ${toTable} ON ${toTable}.${toKey}=${fromTable}.${fromKey} AND
                        ${toTable}.${field.toLowerCase()}=${where[key]}`
                }
            }
            delete where[key]
        }
        whereQuery = whereQuery.join(' AND ')
        return [joinQuery, whereQuery]
    }

    PostgreSQL.prototype.buildWhere = function(model, where) {
        var whereClause = this._buildWhere(model, where);
        var searchObj = getSearchQuery(where)
        var [joinQuery, whereQuery] = this.getJoinQuery(model, where)
        this.isJoinSearch = searchObj.join ? true : false

        let sql = ''
        if (joinQuery) {
            sql = `${sql} ${joinQuery}`
        }
        if (searchObj.join) {
            sql = `${sql} ${searchObj.join}`
        }
        let whereArr = [whereClause.sql, searchObj.searchClause, whereQuery].reduce((prev, val) => {
            if (val) prev.push(val)
            return prev
        }, [])
        if (whereArr.length > 0)
            sql = `${sql} WHERE ${whereArr.join(' AND ')}`
        whereClause.sql = sql

        return whereClause
    }

    /**
     * @private
     * @param model
     * @param where
     * @returns {ParameterizedSQL}
     */
    PostgreSQL.prototype._buildWhere = function(model, where) {
      var columnValue, sqlExp;
      if (!where) {
        return new ParameterizedSQL('');
      }
      if (typeof where !== 'object' || Array.isArray(where)) {
        debug('Invalid value for where: %j', where);
        return new ParameterizedSQL('');
      }
      var self = this;
      var props = self.getModelDefinition(model).properties;

      var whereStmts = [];
      for (var key in where) {
        var stmt = new ParameterizedSQL('', []);
        // Handle and/or operators
        if (key === 'and' || key === 'or') {
          var branches = [];
          var branchParams = [];
          var clauses = where[key];
          if (Array.isArray(clauses)) {
            for (var i = 0, n = clauses.length; i < n; i++) {
              var stmtForClause = self._buildWhere(model, clauses[i]);
              if (stmtForClause.sql) {
                stmtForClause.sql = '(' + stmtForClause.sql + ')';
                branchParams = branchParams.concat(stmtForClause.params);
                branches.push(stmtForClause.sql);
              }
            }
            stmt.merge({
              sql: branches.join(' ' + key.toUpperCase() + ' '),
              params: branchParams,
            });
            whereStmts.push(stmt);
            continue;
          }
          // The value is not an array, fall back to regular fields
        }
        var p = props[key];

        if (p == null && isNested(key)) {
          // See if we are querying nested json
          p = props[key.split('.')[0]];
        }

        if (p == null) {
          // Unknown property, ignore it
          debug('Unknown property %s is skipped for model %s', key, model);
          continue;
        }
        // eslint-disable one-var
        var expression = where[key];
        var columnName = self.escapeName(model.toLowerCase()) + '.' + self.columnEscaped(model, key);
        // eslint-enable one-var
        if (expression === null || expression === undefined) {
          stmt.merge(columnName + ' IS NULL');
        } else if (expression && expression.constructor === Object) {
          var operator = Object.keys(expression)[0];
          // Get the expression without the operator
          expression = expression[operator];
          if (operator === 'inq' || operator === 'nin' || operator === 'between') {
            columnValue = [];
            if (Array.isArray(expression)) {
              // Column value is a list
              for (var j = 0, m = expression.length; j < m; j++) {
                columnValue.push(this.toColumnValue(p, expression[j]));
              }
            } else {
              columnValue.push(this.toColumnValue(p, expression));
            }
            if (operator === 'between') {
              // BETWEEN v1 AND v2
              var v1 = columnValue[0] === undefined ? null : columnValue[0];
              var v2 = columnValue[1] === undefined ? null : columnValue[1];
              columnValue = [v1, v2];
            } else {
              // IN (v1,v2,v3) or NOT IN (v1,v2,v3)
              if (columnValue.length === 0) {
                if (operator === 'inq') {
                  columnValue = [null];
                } else {
                  // nin () is true
                  continue;
                }
              }
            }
          } else if (operator === 'regexp' && expression instanceof RegExp) {
            // do not coerce RegExp based on property definitions
            columnValue = expression;
          } else {
            columnValue = this.toColumnValue(p, expression);
          }
          sqlExp = self.buildExpression(columnName, operator, columnValue, p);
          stmt.merge(sqlExp);
        } else {
          // The expression is the field value, not a condition
          columnValue = self.toColumnValue(p, expression);
          if (columnValue === null) {
            stmt.merge(columnName + ' IS NULL');
          } else {
            if (columnValue instanceof ParameterizedSQL) {
              if (p.type.name === 'GeoPoint')
                stmt.merge(columnName + '~=').merge(columnValue);
              else
                stmt.merge(columnName + '=').merge(columnValue);
            } else {
              stmt.merge({
                sql: columnName + '=?',
                params: [columnValue],
              });
            }
          }
        }
        whereStmts.push(stmt);
      }
      var params = [];
      var sqls = [];
      for (var k = 0, s = whereStmts.length; k < s; k++) {
        sqls.push(whereStmts[k].sql);
        params = params.concat(whereStmts[k].params);
      }
      var whereStmt = new ParameterizedSQL({
        sql: sqls.join(' AND '),
        params: params,
      });
      return whereStmt;
    };

    PostgreSQL.prototype.columnEscaped = function (model, property) {
        if (isNested(property)) {
            // Convert column to PostgreSQL json style query: "model"->>'val'
            var self = this
            return property
                .split('.')
                .map(function (val, idx) { return (idx === 0 ? self.columnEscaped(model, val) : escapeLiteral(val)) })
                .reduce(function (prev, next, idx, arr) {
                    return idx == 0 ? next : idx < arr.length - 1 ? prev + '->' + next : prev + '->>' + next
                })
        } else {
            return this.escapeName(this.column(model, property))
        }
    }

    PostgreSQL.prototype.buildColumnNames = function(model, filter) {
        var fieldsFilter = filter && filter.fields;
        var cols = this.getModelDefinition(model).properties;
        if (!cols) {
        return '*';
        }
        var self = this;
        if (filter && filter.where) {
            if (!filter.where.refSearch) {
                this.isJoinSearch = false;
            } else {
                this.isJoinSearch = true;
            }
        }
        var keys = Object.keys(cols);
        if (Array.isArray(fieldsFilter) && fieldsFilter.length > 0) {
        // Not empty array, including all the fields that are valid properties
        keys = fieldsFilter.filter(function(f) {
            return cols[f];
        });
        } else if ('object' === typeof fieldsFilter &&
        Object.keys(fieldsFilter).length > 0) {
        // { field1: boolean, field2: boolean ... }
        var included = [];
        var excluded = [];
        keys.forEach(function(k) {
            if (fieldsFilter[k]) {
            included.push(k);
            } else if ((k in fieldsFilter) && !fieldsFilter[k]) {
            excluded.push(k);
            }
        });
        if (included.length > 0) {
            keys = included;
        } else if (excluded.length > 0) {
            excluded.forEach(function(e) {
            var index = keys.indexOf(e);
            keys.splice(index, 1);
            });
        }
        }
        var names = keys.map(function(c) {
            return self.escapeName(model.toLowerCase()) + '.' + self.columnEscaped(model, c);
        });
        return names.join(',');
    };

    function getSearchQuery(where) {
        let retval = { join: '' }
        let joinArr = []
        let searchClause = []
        if (where.refSearch) {
            if (where.refSearch.join) {
                if (Array.isArray(where.refSearch.join)) {
                    where.refSearch.join.forEach(value => {
                        let strSrc = `${value.source.model}.${value.source.field}`
                        let strDes = `${value.des.model}.${value.des.field}`
                        joinArr.push(` inner join ${value.des.model} on ${strSrc} = ${strDes}`)
                    })
                }
            }
            if (where.refSearch.keysSearch) {
                if (Array.isArray(where.refSearch.keysSearch)) {
                    where.refSearch.keysSearch.forEach(value => {
                        let strQuery = `${value.field}::text ILIKE  \'%${value.value}%\'`
                        searchClause.push(strQuery)
                    })
                }
            }
            let join = joinArr.join(' ').trim()
            let search = searchClause.join(' OR ').trim()
            retval = { join: join, searchClause: search }
        }
        return retval
    }

    function isNested(property) {
        return property.split('.').length > 1
    }

    function escapeLiteral(str) {
        var hasBackslash = false
        var escaped = '\''
        for (var i = 0; i < str.length; i++) {
            var c = str[i]
            if (c === '\'') {
                escaped += c + c
            } else if (c === '\\') {
                escaped += c + c
                hasBackslash = true
            } else {
                escaped += c
            }
        }
        escaped += '\''
        if (hasBackslash === true) {
            escaped = ' E' + escaped
        }
        return escaped
    }
}


