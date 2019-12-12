const buildCompositeJoins = (Model, joins, columnname) => {
  let len = joins.length
  let join = []
  let keysSearch = []

  for (let idx = 0; idx < len; idx++) {
    let join = joins[idx]
    let relationModel = Model.relations[join]
    if (!relationModel) continue

    let source = { model: relationModel.modelFrom.name.toLowerCase(), field: relationModel.keyFrom }
    let des = { model: relationModel.modelTo.name.toLowerCase(), field: relationModel.keyTo }

    let joinQuery = { source, des }
    join.push(joinQuery)

    let modelName = relationModel.modelTo.name.toLowerCase()
    let field = `${modelName}.${columnname}`
    let value = ''

    keysSearch.push({
      field, value
    })
  }

  Model.refSearch = { join, keysSearch }
}

const getCompositeValue = (instance, fields, columnname) => {
  let len = fields.length
  let values = []
  for (let idx = 0; idx < len; idx++) {
    let field = fields[idx]
    let value = instance[field] || ''
    value = value.toLowerCase().trim()
    values.push(value)
  }

  return values.join(' ').toLowerCase().trim()
}

/**
 * @example
 * import searchText from './search-text'
 * 
 * // allows to look up for a house and its owner
 * searchText(app.models.Owner, ['name', 'tel'])
 * searchText(app.models.House, ['address'], ['owner'])
 * 
 * @param {Object} Model a business model
 * @param {array} searchFields a list of columns
 * @param {array} joinRelations a list of relations used for building join query
 */
export default (Model, searchFields, joinRelations, columnname = 'searchfield') => {
  // defines new column
  Model.defineProperty(columnname, { type: String, required: false })

  // if table joins
  if (joinRelations && Array.isArray(joinRelations)) {
    buildCompositeJoins(Model, joinRelations, columnname)
  }

  // update composite search value
  Model.observe('before save', async (ctx) => {
    if (ctx.instance && searchFields && Array.isArray(searchFields)) {
      let value = getCompositeValue(ctx.instance, searchFields, columnname)
      ctx.instance[columnname] = value
    }
  })

  Model.observe('access', async (ctx) => {
    let filter = ctx.query || {}
    filter.where = filter.where || {}

    if (filter.where['$text']) {
      let paramValue = filter.where['$text'].search || ''

      if (ctx.Model.refSearch) {
        ctx.Model.refSearch.keysSearch.forEach(value => {
          value.value = paramValue.toLowerCase()
        })
        filter.where.refSearch = ctx.Model.refSearch
      } else {
        let ilike = `%${paramValue.toLowerCase()}%`
        filter.where[columnname] = { ilike }
      }
      delete filter.where['$text']
    }
    ctx.query = filter
  })
}
