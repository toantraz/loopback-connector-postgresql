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
export default (Model, searchFields, joinRelations, columnName = 'searchfield') => {
  Model.defineProperty(columnName, {type: String, required: false})

  if (joinRelations && Array.isArray(joinRelations)) {
    let refSearch = {}
    refSearch.join = []
    refSearch.keysSearch = []
    let field = `${Model.name.toLowerCase()}.${columnName}`
    refSearch.keysSearch.push({ field, value: ''})

    joinRelations.forEach(obj => {
      let relationObj = Model.relations[obj]
      if (relationObj) {
        var joinObj = {}                    
        joinObj.source = { model: relationObj.modelFrom.name.toLowerCase(), field: relationObj.keyFrom }
        joinObj.des = { model: relationObj.modelTo.name.toLowerCase(), field: relationObj.keyTo }
        refSearch.join.push(joinObj)

        let relField = `${relationObj.modelTo.name.toLowerCase()}.${columnName}`
        refSearch.keysSearch.push({ field: relField, value: ''})
      }
    })
    Model.refSearch = refSearch
  }

  Model.observe('before save', async (ctx) => {
    if (searchFields && Array.isArray(searchFields)) {
      let searchText = ''
      if (ctx.instance) {
        searchFields.forEach(field => {
          let fieldData = ctx.instance[field]
          if (fieldData) {
            searchText += fieldData.toLowerCase() + ' '
          }
        })
        searchText = searchText.trim()
        ctx.instance[columnName] = searchText
      }
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
        filter.where[columnName] = {ilike:'%' + paramValue.toLowerCase() + '%'}
      }
      delete filter.where['$text']
    }
    ctx.query = filter
  })
}
