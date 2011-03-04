$(function(){

    var direction = -1, distance = 5;
    setInterval(function() {
        var $ball = $('#ball'),
            $field = $('#field'),
            $leftPaddle = $('#left_paddle'),
            $rightPaddle = $('#right_paddle'),
            currentPos = [ parseInt( $ball.css( 'left' ), 10 ), 
                           parseInt( $ball.css( 'top' ), 10 ) ];

        var paddleHit = function(paddle, pos) {
            var topPos = parseInt( paddle.css( 'top' ), 10 ),
                bottomPos = parseInt( paddle.css( 'height' ), 10 ) + topPos;
            return ( pos[1] >= topPos && pos[1] < bottomPos ); 
        }

        var leftBoundry = function(pos, paddle, dist) {
            return ( pos[0] < parseInt( paddle.css( 'left' ), 10 ) + dist && paddleHit( paddle, pos ) );
        };

        var rightBoundry = function(pos, paddle, dist, field) {
            return ( pos[0] > field.width() - dist * 2 && paddleHit( paddle, pos) );
        };

        if( leftBoundry( currentPos, $leftPaddle, distance ) ) {
            direction = 1;
        }

        if( rightBoundry( currentPos, $rightPaddle, distance, $field ) ) {
            direction = -1;
        }

        var newLeft = currentPos[0] + (direction*distance);
        $ball.css('left', newLeft);
    }, 30);

});

$(function(){
    var mover = function(paddle, direction) {
        var topPos = parseInt( paddle.css( 'top' ), 10 );
        paddle.css( 'top', topPos + ( 5*direction ) ); 
    };
    // a z move left up and down
    // / ' move right up and down
    $(document).keydown(function(e) {
        var leftUp = function(){ 
            mover($('#left_paddle'), -1);
        };
        var leftDown = function(){
            mover($('#left_paddle'), 1);
        };
        var rightUp = function(){
            mover($('#right_paddle'), -1);
        };
        var rightDown = function(){
            mover($('#right_paddle'), 1);
        };
        var directions = { 65  : leftUp,
                           90  : leftDown,
                           191 : rightDown,
                           222 : rightUp };

        func = directions[e.which];
        if( func ) {
            func();
            e.preventDefault();
        }
    });
});
