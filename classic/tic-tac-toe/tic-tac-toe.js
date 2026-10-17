$(function(){
    var rows = [
        // horizontal
        'div:nth-child(3n+1)',
        'div:nth-child(3n+2)',
        'div:nth-child(3n+3)',
        // cross
        'div:nth-child(4n+1)',
        'div:nth-child(2n+3):not(:last)',
        // verticlal
        'div:lt(3)',
        'div:gt(2):lt(3)',
        'div:gt(5):lt(3)'];

    var turn = 0;
    var checkWin = function(selector){
        var classes = $.map($("#board "+selector), function(el) {
            var className = $(el).attr('class');
            if( className === "") {
                return undefined;
            } else {
              
                return parseInt(className.slice(-1),10);
            }
        });
        if(classes.length === 3){
            var sum = eval(classes.join("+"));
            if(sum === 0 || sum === 3) {
                $('#msg').html({'3' : 'Blue WINS',
                 '0' : 'Red WINS'}[sum]);
                $("#board div:not(.red):not(.blue)").die();
            }
        }
    };
    $("#board div:not(.red):not(.blue)").live('click', function() {
        turn++;
        if(turn & 1) {
            $(this).addClass('red0');
        } else {
            $(this).addClass('blue1');
        }
        $.each(rows, function(index, val) {
            checkWin(val);
        });
    });

});

