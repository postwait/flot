// TODO:
// * Update datamax & datamin for each axis (x,y,x2,y2)
// * ^ Decide whether to return to processOptions hook (before datamax/min are calculated)
(function ($) {

    Array.max = function( array ){
        return Math.max.apply( Math, array );
    };

    Array.min = function( array ){
        return Math.min.apply( Math, array );
    };

    var options = {
            series: { stack: null } // or number/string
        },
        all_series;

    $.plot.plugins.push({
        init: init,
        options: options,
        name: 'circonus_stack',
        version: '1.0'
    });

    function init( plot )
    {
        //console.log('stacking plugin init', 'colors', plot.getOptions().colors);
        plot.hooks.processRawData.push(processStacks);
        plot.hooks.draw.push(drawStacks);
    }

    function processStacks( plot, plot_series, data, datapoints )
    {
        all_series = plot.getData();
        //console.log('pS', plot, plot_series, $.inArray( plot_series, all_series), all_series.length-1);
        if ($.inArray( plot_series, all_series) != all_series.length-1){ return; }

        var opts = plot.getOptions(), sets = (opts.stacks || opts.stackSets);
        var setsi = -1, setsl = (sets && sets.length), set;
        var seti, setl, series, s;
        var below_index, below_data, ndx, series;
        //console.groupCollapsed('process stacks');
        //console.log('sets', sets, 'opts', opts, opts.colors, all_series[0], all_series[0].color);
        while ( ++setsi < setsl ) {
            set = sets[setsi];
            setl = set.length;
            seti = -1;
            //console.groupCollapsed('stack set '+ setsi);
            //console.log('set', set);
            while ( ++seti < setl ){
                s = set[seti]
                series = all_series[s];
                if (!series || series.hidden){ continue; }
                //console.groupCollapsed('point '+s);
                //console.log(series, (series && series.dataname));
                ndx = s;
                if (ndx >= 0){
                    series.b_ndx = below_index = findLowerInStacks(ndx, all_series, sets);
                    if (! series.orig){ series.orig = {}; }
                    series.orig.data = Circonus.util.deepCopy(series.data);
                    //console.log('below_index', below_index);
                    if (below_index > -1) {
                        //console.log(s, series);
                        stackData(all_series, s, below_index);
                        series.datapoints.points = Circonus.util.flatten(series.data);
                    } else {
                        //console.log('NOT stacking', ndx, 'b/c of b_index', below_index, series);
                    }
                } else {
                    //console.log('no o_index', ndx, 'NOT stacking', series);
                }
                //console.groupEnd('point '+s);
            } // each series in set
            //console.groupEnd('stack set '+ setsi);
        } // each set in stacks
        //console.groupEnd('process stacks');
    }

    function drawStacks( plot, ctx )
    {
        //console.groupCollapsed('draw stacks');
        var canvas = plot.getCanvas();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        draw.call(plot, all_series);
        //console.groupEnd('draw stacks');
    }

    function stackData( all_series, i, below_index )
    {
        //console.log('sD', all_series[i], all_series[below_index]);
        //if we get a bad index, or if the current series or the one below it are hidden, dont stack
        var curr_series = all_series[i], b_series = all_series[below_index];

        if( !curr_series ||
            !b_series ||
            !curr_series.lines.show ||
            !b_series.lines.show ||
            curr_series.hidden ||
            b_series.hidden ||
            curr_series.metric_type != "numeric" ||
            b_series.metric_type != "numeric"
          ){
            //console.log('return without stacking', i, below_index);
            return;
        }
        //console.log('stackData', i, curr_series, b_series);

        var bdata = b_series.data, curr_data;
        var tdata = curr_series.orig.data;
        var new_bdata = [], new_tdata = [];
        var blen = bdata.length;
        var tlen = tdata.length;
        var bottom_i = 0, top_i = 0;
        var interpolated_format = [
            {number: true, required: true, x: true},
            {number: true, required: true, y: true},
            {number: false, required: false}
        ];

        // make sure series[below_index].data and series[i].data have the same X (interpolating where needed)
        curr_series.datapoints.format = b_series.datapoints.format = interpolated_format;
        while(bottom_i < blen && top_i < tlen) {
            if(bdata[bottom_i][0] == tdata[top_i][0]) {
                new_tdata[new_tdata.length] = tdata[top_i++];
                new_bdata[new_bdata.length] = bdata[bottom_i++];
            }
            else {
                if(bdata[bottom_i][0] < tdata[top_i][0]) {
                    if(top_i == 0){ new_tdata[new_tdata.length] = [ bdata[bottom_i][0], null, '~' ]; }
                    else { // interpolate
                        var needed_x = bdata[bottom_i][0];
                        new_tdata[new_tdata.length] = [ needed_x,
                                                        interpolate(tdata[top_i-1], tdata[top_i], needed_x), '~' ];
                    }
                    new_bdata[new_bdata.length] = bdata[bottom_i++];
                }
                else {
                    if(bottom_i == 0){ new_bdata[new_bdata.length] = [ tdata[top_i][0], null, '~' ]; }
                    else { // interpolate
                        var needed_x = tdata[top_i][0];
                        new_bdata[new_bdata.length] = [ needed_x,
                                                        interpolate(bdata[bottom_i-1], bdata[bottom_i], needed_x), '~' ];
                    }
                    new_tdata[new_tdata.length] = tdata[top_i++];
                }
            }
        }
        // if we're short on one, extend the other to match
        while(bottom_i < blen) {
            new_tdata[new_tdata.length] = [ bdata[bottom_i][0], null, '~' ];
            new_bdata[new_bdata.length] = bdata[bottom_i++];
        }
        while(top_i < tlen) {
            new_bdata[new_bdata.length] = [ tdata[top_i][0], null, '~' ];
            new_tdata[new_tdata.length] = tdata[top_i++];
        }

        // swap in the new interpolated sets.
        tdata = all_series[i].data = new_tdata;
        bdata = all_series[below_index].data = new_bdata;
        curr_series = all_series[i], b_series = all_series[below_index];
        //console.groupCollapsed('tdata & bdata');
        //console.log('tdata', tdata);
        //console.log('bdata', bdata);
        //console.groupEnd('tdata & bdata');
        //console.groupCollapsed('add stack vals');

        curr_series.orig.data = Circonus.util.deepCopy(curr_series.data);
        if (below_index == 0){ b_series.orig.data = Circonus.util.deepCopy(b_series.data); }

        // we've gauranteed one-for-one X values throughout the datasets... it's as easy as adding now
        var j = -1, l = curr_series.data.length;
        while ( ++j < l ) {
            if (tdata[j][1] == null){ tdata[j][1] = parseFloat(bdata[j][1] * 1); }
            else { tdata[j][1] = tdata[j][1] * 1 + parseFloat(bdata[j][1] * 1); }
        }
        //console.groupEnd('add stack vals')
    }

    function binarySearch( a, v, high, low )
    {
        high = high*1;
        low = low*1;
        if (! high && high !== 0){ high = a.length - 1; }
        if (! low && low !== 0){ low = 0; }

        if (high < low) {
            if(high==-1) {var r = { found: false, index: low}; return r;}
            else if(low ==a.length) { var r = { found: false, index: high}; return r;}
            else {
                if(Math.abs(a[high][0]-v) < Math.abs(a[low][0]-v)){var r = { found: false, index: high}; return r;}
                else {var r = { found: false, index: low}; return r;}
            }
        }
        var middle = parseInt(((high-low)/2))+ low;
        if(middle>=a.length || a[middle] == null) {
            var r = { found: false, index: middle }; return r;
        } //bad index, somehow
        if(a[middle][0] > v){return binarySearch(a, v, middle-1, low); }
        else if(a[middle][0] < v){return binarySearch(a, v, high, middle+1); }
        else { var r =  { found: true, index: middle}; return r;}
    }

    //this will lerp to the y value at x=t using points p1 and p2
    function interpolate( p1, p2, t )
    {
        var mp1 = [ p1[0] *= 1, p1[1] *= 1 ];
        var mp2 = [ p2[0] *= 1, p2[1] *= 1 ];
        var dx = mp2[0] - mp1[0];
        var dy = mp2[1] - mp1[1];

        return (dy/dx)*(t-mp1[0]) + mp1[1];
    }

    function findLowerInStacks( needle, alL_series, sets )
    {
        var below_index = -1, counter = 0;
        if (needle > 0){
            // sets = [ [0,2], [1], [] ]
            for (var sets_i = -1, sets_l = sets.length, stack, ndx; ++sets_i < sets_l;) {
                stack = sets[sets_i]; // [0,2]
                ndx = $.inArray(needle, stack);
                //console.log('is', needle,'in', stack, 'at', ndx, '?');
                if (ndx >= 0){
                    //console.log('found', needle, 'in', stack, 'at', ndx, all_series[ndx]);
                    do {
                        --ndx;
                    } while ( ndx >= 0 && all_series[ stack[ndx] ].hidden)
                    below_index = stack[ndx];
                    break;
                }
            }
        }
        return below_index;
    }

    /* Flot functions we're altering / duplicating */
    function draw( all_series )
    {
        var plot = this, ctx = plot.getCanvas().getContext('2d'), opts = plot.getOptions();
        //console.log('draw() opts', opts, opts.colors)
        var i = -1, len = all_series.length, series, b_series, ndx;
        var cleared = false;

        plot.drawGrid();
        Circonus.flot.drawClippingMask(plot, ctx);

        while ( ++i < len ) {
            series = all_series[i];
            b_series = null;
            ndx = series.b_ndx;
            if (ndx > -1){ b_series = all_series[ndx]; }
            //drawSeries(series, b_series);
            //console.log('draw', i, 'b', ndx, series, b_series);
            if (series.lines.show){
                drawSeriesLines.call(plot, series, b_series );
            }
        }

    }

    function drawSeriesLines( series, b_series )
    {
        var plot = this, ctx = plot.getCanvas().getContext('2d');
        var plotOffset = plot.getPlotOffset();
        ctx.save();
        ctx.translate(plotOffset.left, plotOffset.top);
        ctx.lineJoin = "round";

        var lw = series.lines.lineWidth;
        var sw = series.shadowSize;
        // FIXME: consider another form of shadow when filling is turned on
        if (sw > 0) {
            // draw shadow in two steps
            ctx.lineWidth = sw / 2;
            ctx.strokeStyle = "rgba(0,0,0,0.1)";
            plotLine.call(plot, series.data, lw/2 + sw/2 + ctx.lineWidth/2, series.xaxis, series.yaxis, series.dataManip);

            ctx.lineWidth = sw / 2;
            ctx.strokeStyle = "rgba(0,0,0,0.2)";
            plotLine.call(plot, series.data, lw/2 + ctx.lineWidth/2, series.xaxis, series.yaxis, series.dataManip);
        }

        ctx.lineWidth = lw;
        ctx.strokeStyle = series.color;
        setFillStyle.call(plot, series.lines, series.color);
        if (series.lines.fill){
            plotLineArea.call(plot, series.data, series.xaxis, series.yaxis, series.dataManip, b_series);
        }

        plotLine.call(plot, series.data, 0, series.xaxis, series.yaxis, series.dataManip);
        ctx.restore();

    } // eo drawSeriesLines

    function plotLine( data, offset, axisx, axisy, dataManip )
    {
        var plot = this, ctx = plot.getCanvas().getContext('2d');
        var prev, curr = null, drawx = null, drawy = null;
        ctx.beginPath();
        var i = -1, l = data.length;
        while ( ++i < l ) {
            prev = curr;

            if(data[i] == null) continue;
            curr = [data[i][0], data[i][1]];

            if(dataManip) curr[1] = dataManip(curr[1]);

            if (!prev || !curr) continue;

            var px1 = prev[0], py1 = prev[1], cx1 = curr[0], cy1 = curr[1];

            if (px1 < axisx.min || px1 > axisx.max ||
                cx1 < axisx.min || cx1 > axisx.max ){
                continue;
            }

            var px1c = axisx.p2c(px1), cx1c = axisx.p2c(cx1);
            var py1c = axisy.p2c(py1), cy1c = axisy.p2c(cy1);
            var py1co = py1c + offset, cy1co = cy1c + offset;
            if (drawx != px1c || drawy != py1co){
                ctx.closePath();
                ctx.beginPath();
                ctx.moveTo(px1c, py1co);
            }

            drawx = cx1c, drawy = cy1co;
            if (py1 !== null && cy1 !== null){
                ctx.lineTo(drawx, drawy);
            } else {
                ctx.moveTo(drawx, drawy);
            }
        }
        ctx.stroke();
        ctx.closePath();
    } // eo plotLine

    function plotLineArea( data, axisx, axisy, dataManip, b_series )
    {
        var plot = this, ctx = this.getCanvas().getContext('2d');
        var bdata = b_series && b_series.data;
        //display manipulation of data is not done until we get here, so we
        //need to call dataManip on b_series, like we do for series below
        if(b_series && dataManip) {
            //console.log('dataManip', dataManip);
            var i = -1, l = bdata.length, bp, by;
            while ( ++i < l ){
                bp = bdata[i], by = bp[1];
                by = dataManip(by);
            }
        }

        //zero negative ymin, then find minimum of that and ymax for bottom
        var bottom = Math.min(Math.max(0, axisy.min), axisy.max);
        var top, lastX = 0;

        var areaOpen = false;
        var pcount = 0;
        var last_by = bottom;
        var first_by = bottom;

        if (b_series) {
            if (bdata[bdata.length-1]) last_by = bdata[bdata.length-1][1];
            if (bdata[0]) first_by = bdata[0][1];
        }

        var i = -1, l = data.length;
        var prev, curr = null;
        while ( ++i < l ) {
            prev = curr;
            curr = [
                data[i][0],
                dataManip ? dataManip( data[i][1] ) : data[i][1]
            ];

            //close only if not stacked
            if (areaOpen && prev != null && curr == null && !b_series) {
                // close area
                ctx.lineTo(axisx.p2c(lastX), axisy.p2c(bottom));
                ctx.fill();
                areaOpen = false;
                continue;
            }

            if (prev == null || curr == null)
                continue;

            var px1 = prev[0], py1 = prev[1], cx1 = curr[0], cy1 = curr[1];

            if (px1 < axisx.min || px1 > axisx.max ||
                cx1 < axisx.min || cx1 > axisx.max ){
                continue;
            }

            if (!areaOpen) {
                // open area
                ctx.beginPath();
                ctx.moveTo(axisx.p2c(px1), axisy.p2c(first_by));
                areaOpen = i;
            }

            // fill the triangles
            ctx.lineTo(axisx.p2c(px1), axisy.p2c(py1));
            ctx.lineTo(axisx.p2c(cx1), axisy.p2c(cy1));
        }

        if (areaOpen){
            if (!b_series) {
                ctx.lineTo(axisx.p2c(curr[0]), axisy.p2c(bottom));
                ctx.fill();
            }
            else {
                ctx.lineTo(axisx.p2c(curr[0]), axisy.p2c(last_by));
                var i = bdata.length, bp, bx, by;
                while ( i-- ) {
                    bp = bdata[i], bx = bp[0], by = bp[1];
                    ctx.lineTo(axisx.p2c(bx), axisy.p2c(by));
                    if (i == areaOpen) break;
                }
                ctx.fill();
                ctx.closePath();
            }//end if dealing with closing a stacked series
        } // end of open area

    } //end plotLineArea

    function setFillStyle( obj, seriesColor )
    {
        var plot = this, ctx = plot.getCanvas().getContext('2d');
        var fill = obj.fill;
        if (!fill)
            return;

        if (obj.fillColor)
            ctx.fillStyle = obj.fillColor;
        else {
            var c = $.color.parse(seriesColor);
            c.a = typeof fill == "boolean" ? 0.4 : fill;
            c.normalize();
            ctx.fillStyle = c.toString();
        }
    }
    /* eo duplicated Flot functions */
})(jQuery);
